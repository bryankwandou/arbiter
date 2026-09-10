"""Flash loan arb bot entry point.

Runs the FlashArbMonitor loop as a standalone process:
  python -m api.flash_server

Or alongside the main Polymarket bot:
  uvicorn api.server:app    # Polymarket
  python -m api.flash_server  # Flash arb (separate process)

Environment variables required:
  BASE_RPC_URL          — Base mainnet RPC (default: https://mainnet.base.org)
  FLASH_ARB_CONTRACT    — Deployed FlashArbitrage.sol address
  DEPLOYER_PRIVATE_KEY  — Wallet that owns the contract
  FLASH_ARB_DRY_RUN     — Set to 0 for live execution (default: 1 = dry run)
  MIN_PROFIT_USD        — Minimum net profit to execute (default: 5.0)
  FLASH_SCAN_INTERVAL   — Seconds between scans (default: 30)
  FLASH_ARB_ONCE        — Scan once and exit (for cron runners)
  FLASH_ARB_BURST_SEC   — Keep scanning for this many seconds, then exit
  BOT_INTERNAL_SECRET   — Shared secret for posting results to /api/flash-arb
  DASHBOARD_URL         — Vercel deployment URL (for reporting)
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time

import httpx
import structlog

from core.flash_arb.monitor import FlashArbMonitor, ScanResult

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
log = structlog.get_logger()

DASHBOARD_URL   = os.getenv("DASHBOARD_URL", "https://arbiterbot.vercel.app")
BOT_SECRET      = os.getenv("BOT_INTERNAL_SECRET", "")
DATABASE_URL    = os.getenv("DATABASE_URL", "")


async def report_to_dashboard(result: ScanResult) -> None:
    """POST scan results to /api/flash-arb for dashboard display."""
    if not BOT_SECRET:
        return
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(
                f"{DASHBOARD_URL}/api/flash-arb",
                headers={"x-bot-secret": BOT_SECRET, "Content-Type": "application/json"},
                content=json.dumps({
                    "pairs_scanned":    result.pairs_scanned,
                    "opportunities":    result.opportunities,
                    "executions":       result.executions,
                    "best_edge_pct":    result.best_edge_pct,
                    "total_profit_usd": result.total_profit_usd,
                    "errors":           result.errors,
                }),
            )
    except Exception as e:
        log.warning("Failed to report to dashboard", error=str(e))


def write_scan_to_db(result: ScanResult) -> None:
    """Insert one scan row straight into Postgres.

    The dashboard POST above is the original transport, but it authenticates
    with a shared secret and silently drops the result whenever the two sides
    disagree — a month of scans was lost that way without a single failed CI
    run. Writing the row here removes the dashboard from the path entirely, so
    a scan that ran is a scan that is recorded.

    Best-effort by design: a scan that cannot be filed is still a scan that
    happened, and the arb loop must not stop because a database is unreachable.
    """
    if not DATABASE_URL:
        return
    try:
        import psycopg  # imported lazily so the bot runs without the driver

        from core.flash_arb.executor import DRY_RUN

        executions = result.executions
        tx_hashes  = [str(e.get("tx_hash", "")) for e in executions if e.get("tx_hash")]

        # Take the flag from the executor, not from the executions list. Derived
        # from the list, a scan that found nothing to execute had nothing to be
        # True, so `any(...)` collapsed to False and filed every dry run as if
        # it had been live — the opposite of what happened, on the one column
        # that says whether real money was at risk.
        dry_run    = DRY_RUN

        with psycopg.connect(DATABASE_URL, connect_timeout=15) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO flash_arb_scans
                      (pairs_scanned, opps_found, best_edge_pct, total_profit_usd,
                       executions, dry_run, tx_hashes, opportunities, errors)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        result.pairs_scanned,
                        len(result.opportunities),
                        result.best_edge_pct,
                        result.total_profit_usd,
                        len(executions),
                        dry_run,
                        tx_hashes,
                        json.dumps(result.opportunities),
                        result.errors,
                    ),
                )
            conn.commit()
        log.info("Scan recorded in database", pairs=result.pairs_scanned)
    except Exception as e:
        log.warning("Failed to record scan in database", error=str(e))


async def main() -> None:
    # Read these off config, not the raw env: config resolves the per-network
    # defaults, so logging the env directly reported mainnet while the bot was
    # actually pointed at Sepolia.
    from core.flash_arb import config

    log.info(
        "⚡ Flash Arb Bot starting",
        network=config.NETWORK,
        chain_id=config.CHAIN_ID,
        rpc=config.BASE_RPC_URL,
        contract=config.FLASH_ARB_CONTRACT or "(not set — deploy first)",
        dry_run=os.getenv("FLASH_ARB_DRY_RUN", "1"),
        dashboard=DASHBOARD_URL,
    )

    monitor = FlashArbMonitor()

    # Override scan_once to also report to dashboard
    _original_scan = monitor.scan_once
    async def _patched_scan() -> ScanResult:
        result = await _original_scan()
        await report_to_dashboard(result)
        write_scan_to_db(result)
        return result
    monitor.scan_once = _patched_scan  # type: ignore[method-assign]

    # One-shot mode for cron runners (GitHub Actions): scan once, report, exit.
    if os.getenv("FLASH_ARB_ONCE", "0") == "1":
        await monitor.scan_once()
        return

    # Burst mode. A workflow declaring "*/10 * * * *" does not get 144 runs a
    # day: GitHub throttles scheduled workflows and drops the rest without
    # failing anything, and the measured delivery on this repo is about 8. A
    # green run history says nothing about how often the market was looked at.
    #
    # How often the trigger fires is not ours to control. How much work each
    # trigger does is: keep scanning for the life of the job instead of exiting
    # after a single pass. Every pass still files its own database row, so the
    # record stays one row per scan rather than one row per run.
    burst_sec = int(os.getenv("FLASH_ARB_BURST_SEC", "0") or 0)
    if burst_sec > 0:
        deadline = time.monotonic() + burst_sec
        scans = 0
        while True:
            await monitor.scan_once()
            scans += 1
            # Stop before a sleep that would outlast the window, so the job ends
            # on a completed scan instead of being killed part-way through one.
            if time.monotonic() + config.SCAN_INTERVAL_SEC >= deadline:
                break
            await asyncio.sleep(config.SCAN_INTERVAL_SEC)
        log.info("Burst complete", scans=scans, window_sec=burst_sec,
                 interval_sec=config.SCAN_INTERVAL_SEC)
        return

    await monitor.run()


if __name__ == "__main__":
    asyncio.run(main())
