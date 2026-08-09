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
  BOT_INTERNAL_SECRET   — Shared secret for posting results to /api/flash-arb
  DASHBOARD_URL         — Vercel deployment URL (for reporting)
"""

from __future__ import annotations

import asyncio
import json
import logging
import os

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
        return result
    monitor.scan_once = _patched_scan  # type: ignore[method-assign]

    # One-shot mode for cron runners (GitHub Actions): scan once, report, exit.
    if os.getenv("FLASH_ARB_ONCE", "0") == "1":
        await monitor.scan_once()
        return

    await monitor.run()


if __name__ == "__main__":
    asyncio.run(main())
