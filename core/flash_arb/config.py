"""Chain constants and addresses for flash loan arbitrage.

Two networks are supported, selected with FLASH_ARB_NETWORK:

  base         Base mainnet (default) — real money
  baseSepolia  Base Sepolia testnet  — free faucet ETH, no real value

Every address below was verified on-chain rather than copied from docs:
`eth_getCode` returns bytecode, and each Aave provider answers `getPool()` with
the pool that answers `ADDRESSES_PROVIDER()` back. A single wrong character here
produced a provider with no contract at it, which made the flash loan contract
undeployable — so treat these as load-bearing and re-verify if you change them.
"""

from __future__ import annotations
import os

NETWORK = os.getenv("FLASH_ARB_NETWORK", "base")
IS_TESTNET = NETWORK == "baseSepolia"

# ── RPC ──────────────────────────────────────────────────────────────────────
_DEFAULT_RPC = "https://sepolia.base.org" if IS_TESTNET else "https://mainnet.base.org"
BASE_RPC_URL: str = os.getenv("BASE_RPC_URL", _DEFAULT_RPC)

# ── Chain ────────────────────────────────────────────────────────────────────
CHAIN_ID = 84532 if IS_TESTNET else 8453

# ── Tokens ───────────────────────────────────────────────────────────────────
WETH = "0x4200000000000000000000000000000000000006"  # same predeploy on both

if IS_TESTNET:
    USDC  = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
    # Aave Base Sepolia lists only USDC and WETH, so the rest have no reserve
    # to flash-borrow from and are left unset.
    cbETH = ""
    cbBTC = ""
    DAI   = ""
    USDbC = ""
else:
    USDC  = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
    cbETH = "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22"
    cbBTC = "0xcbB7C0000ab88B473b1f5aFd9ef808440eed33Bf"
    DAI   = "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb"
    USDbC = "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA"  # bridged USDC (legacy)

# ── Aave V3 ──────────────────────────────────────────────────────────────────
if IS_TESTNET:
    AAVE_POOL_ADDRESSES_PROVIDER = "0xd449FeD49d9C443688d6816fE6872F21402e41de"
    AAVE_POOL                    = "0x07eA79F68B2B3df564D0A34F8e19D9B1e339814b"
else:
    AAVE_POOL_ADDRESSES_PROVIDER = "0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D"
    AAVE_POOL                    = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5"

# ── Uniswap V3 ───────────────────────────────────────────────────────────────
if IS_TESTNET:
    UNISWAP_V3_ROUTER  = "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4"  # SwapRouter02
    UNISWAP_V3_QUOTER  = "0xC5290058841028F1614F3A6F0F5816cAd0df5E27"  # QuoterV2
    UNISWAP_V3_FACTORY = "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24"
else:
    UNISWAP_V3_ROUTER  = "0x2626664c2603336E57B271c5C0b26F421741e481"  # SwapRouter02
    UNISWAP_V3_QUOTER  = "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a"  # QuoterV2
    UNISWAP_V3_FACTORY = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD"

# ── Aerodrome (mainnet only — not deployed on Base Sepolia) ───────────────────
AERODROME_ROUTER  = "" if IS_TESTNET else "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43"
AERODROME_FACTORY = "" if IS_TESTNET else "0x420DD381b31aEf6683db6B902084cB0FFECe40Da"

# ── Flash Arb Contract ────────────────────────────────────────────────────────
FLASH_ARB_CONTRACT = os.getenv("FLASH_ARB_CONTRACT", "")

# ── Uniswap V3 fee tiers (in 1/1,000,000 units) ──────────────────────────────
FEE_LOWEST = 100    # 0.01%
FEE_LOW    = 500    # 0.05%
FEE_MEDIUM = 3000   # 0.30%
FEE_HIGH   = 10000  # 1.00%

# ── Scan configuration ────────────────────────────────────────────────────────
# Each tuple: (tokenIn, tokenOut, borrow_amount, label)
# borrow_amount is in the smallest unit of tokenIn.
SCAN_PAIRS: list[tuple[str, str, int, str]]
if IS_TESTNET:
    # Only the pair Aave Sepolia can actually lend, and smaller size: the
    # testnet USDC/WETH pools are thin, so a mainnet-sized borrow would move
    # them far enough to drown any edge in price impact.
    SCAN_PAIRS = [
        (USDC, WETH, 100_000_000,             "USDC→WETH"),  # 100 USDC (6 dec)
        (WETH, USDC, 50_000_000_000_000_000,  "WETH→USDC"),  # 0.05 WETH (18 dec)
    ]
else:
    SCAN_PAIRS = [
        (USDC,  WETH,  10_000_000_000, "USDC→WETH"),   # borrow 10,000 USDC (6 dec)
        (WETH,  USDC,  1_000_000_000_000_000_000, "WETH→USDC"),  # borrow 1 WETH (18 dec)
        (USDC,  cbETH, 10_000_000_000, "USDC→cbETH"),
        (USDC,  DAI,   10_000_000_000, "USDC→DAI"),
    ]

# ── Bot settings ──────────────────────────────────────────────────────────────
# Testnet profit is play money, so the floor drops to a cent — otherwise no
# trade would ever clear and there would be nothing to observe.
MIN_PROFIT_USD    = float(os.getenv("MIN_PROFIT_USD", "0.01" if IS_TESTNET else "5.0"))
SCAN_INTERVAL_SEC = int(os.getenv("FLASH_SCAN_INTERVAL", "30"))  # scan every 30s
MAX_GAS_GWEI      = float(os.getenv("MAX_GAS_GWEI", "0.01"))    # Base is very cheap

# Aave V3 flash loan fee = 5 bps (0.05%)
AAVE_FLASH_FEE_BPS = 5
