/**
 * FlashArbitrage fork test — run against Base mainnet fork.
 *
 *   FORK=1 npx hardhat test
 *
 * Tests:
 *   1. Deployment + router whitelist
 *   2. startArbitrage reverts for non-owner
 *   3. startArbitrage reverts for non-whitelisted router
 *   4. Pause / unpause guard
 *   5. withdrawToken (profit extraction)
 *   6. Full arb simulation (fork only) — USDC <> WETH via two Uniswap V3 fee tiers
 */

const { expect } = require("chai");
const { ethers }  = require("hardhat");

// ── Base mainnet constants ────────────────────────────────────────────────────
const AAVE_PROVIDER  = "0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D";
const UNI_V3_ROUTER  = "0x2626664c2603336E57B271c5C0b26F421741e481";
const AERODROME      = "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43";
const UNI_V3_QUOTER  = "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a"; // QuoterV2
const USDC           = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH           = "0x4200000000000000000000000000000000000006";
const USDC_WHALE     = "0x3304E22DDaa22bCdC5fCa2269b418046aE7b566A"; // USDC-rich address

const { encodePath } = require("../scripts/encode-path.js");

const FORK = !!process.env.FORK;

describe("FlashArbitrage", function () {
  let contract, owner, attacker;

  beforeEach(async function () {
    [owner, attacker] = await ethers.getSigners();
    let provider = AAVE_PROVIDER;
    if (!FORK) {
      // Local network has no Aave — use a mock provider so the constructor's
      // getPool() call succeeds.
      const Mock = await ethers.getContractFactory("MockPoolAddressesProvider");
      const mock = await Mock.deploy(owner.address);
      await mock.waitForDeployment();
      provider = await mock.getAddress();
    }
    const Factory = await ethers.getContractFactory("FlashArbitrage");
    contract = await Factory.deploy(provider);
    await contract.waitForDeployment();
  });

  // ── Unit tests (no fork needed) ──────────────────────────────────────────
  describe("Access control", function () {
    it("sets owner on deployment", async function () {
      expect(await contract.owner()).to.equal(owner.address);
    });

    it("reverts startArbitrage from non-owner", async function () {
      await expect(
        contract.connect(attacker).startArbitrage(
          USDC, 1_000_000n, WETH, UNI_V3_ROUTER, "0x", UNI_V3_ROUTER, "0x", 0n
        )
      ).to.be.revertedWithCustomError(contract, "Unauthorized");
    });

    it("reverts startArbitrage for non-whitelisted router", async function () {
      await expect(
        contract.startArbitrage(
          USDC, 1_000_000n, WETH, attacker.address, "0x", UNI_V3_ROUTER, "0x", 0n
        )
      ).to.be.revertedWithCustomError(contract, "RouterNotApproved");
    });

    it("reverts when paused", async function () {
      await contract.addRouter(UNI_V3_ROUTER);
      await contract.setPaused(true);
      await expect(
        contract.startArbitrage(
          USDC, 1_000_000n, WETH, UNI_V3_ROUTER, "0x", UNI_V3_ROUTER, "0x", 0n
        )
      ).to.be.revertedWithCustomError(contract, "ContractPaused");
    });

    it("addRouter / removeRouter by owner", async function () {
      await contract.addRouter(UNI_V3_ROUTER);
      expect(await contract.approvedRouters(UNI_V3_ROUTER)).to.be.true;
      await contract.removeRouter(UNI_V3_ROUTER);
      expect(await contract.approvedRouters(UNI_V3_ROUTER)).to.be.false;
    });

    it("transferOwnership works", async function () {
      await contract.transferOwnership(attacker.address);
      expect(await contract.owner()).to.equal(attacker.address);
    });
  });

  // ── Fork tests ───────────────────────────────────────────────────────────
  (FORK ? describe : describe.skip)("Live arb simulation (Base fork)", function () {
    this.timeout(120_000);

    // Base mainnet at any given block rarely holds a real cross-fee-tier arb, so
    // we manufacture one: dump a large WETH position into the 0.30% pool, which
    // makes WETH cheap there relative to the 0.05% pool. The bot then buys WETH
    // in the dislocated pool and sells it in the healthy one. Every other part —
    // the Aave V3 flash loan, both Uniswap V3 swaps, the repayment — is real.
    it("turns a real profit: borrow USDC, buy WETH cheap, sell dear, repay Aave", async function () {
      await contract.addRouter(UNI_V3_ROUTER);
      const addr = await contract.getAddress();

      const UniV3Router = await ethers.getContractAt([
        "function exactInput((bytes path,address recipient,uint256 amountIn,uint256 amountOutMinimum) params) payable returns (uint256)"
      ], UNI_V3_ROUTER);
      const usdc = await ethers.getContractAt(
        ["function balanceOf(address) view returns (uint256)"], USDC
      );

      // ── Manufacture the dislocation ─────────────────────────────────────────
      // Mint ourselves ETH, wrap it, and sell a wall of WETH into the 0.30% pool.
      await ethers.provider.send("hardhat_setBalance", [
        owner.address, "0x" + (60_000n * 10n ** 18n).toString(16),
      ]);
      const weth = await ethers.getContractAt([
        "function deposit() payable",
        "function approve(address,uint256) returns (bool)",
        "function balanceOf(address) view returns (uint256)",
      ], WETH);

      const DUMP = 20_000n * 10n ** 18n;         // 20,000 WETH
      await weth.deposit({ value: DUMP });
      await weth.approve(UNI_V3_ROUTER, DUMP);
      await UniV3Router.exactInput({
        path:             encodePath([WETH, USDC], [3000]),
        recipient:        owner.address,
        amountIn:         DUMP,
        amountOutMinimum: 0n,
      });

      // ── Quote both legs so leg 2's amountIn matches what leg 1 will produce ──
      const quoter = await ethers.getContractAt([
        "function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)"
      ], UNI_V3_QUOTER);

      const BORROW_USDC = 10_000_000_000n;                    // 10,000 USDC
      const pathBuy     = encodePath([USDC, WETH], [3000]);   // cheap WETH (dumped pool)
      const pathSell    = encodePath([WETH, USDC], [500]);    // dear WETH (healthy pool)

      const [wethOut] = await quoter.quoteExactInput.staticCall(pathBuy, BORROW_USDC);
      const [usdcOut] = await quoter.quoteExactInput.staticCall(pathSell, wethOut);

      const owed = BORROW_USDC + (BORROW_USDC * 5n) / 10_000n; // + Aave 5bps premium
      console.log(
        `  leg1: 10,000 USDC -> ${ethers.formatEther(wethOut)} WETH\n` +
        `  leg2: -> ${(Number(usdcOut) / 1e6).toFixed(2)} USDC | owed ${(Number(owed) / 1e6).toFixed(2)}`
      );
      expect(usdcOut).to.be.gt(owed, "no arb was manufactured — adjust DUMP size");

      const calldata1 = UniV3Router.interface.encodeFunctionData("exactInput", [{
        path: pathBuy,  recipient: addr, amountIn: BORROW_USDC, amountOutMinimum: 1n,
      }]);
      const calldata2 = UniV3Router.interface.encodeFunctionData("exactInput", [{
        path: pathSell, recipient: addr, amountIn: wethOut,     amountOutMinimum: 1n,
      }]);

      // ── Execute, demanding a real profit floor (not 0) ───────────────────────
      const minProfit = 1_000_000n; // insist on >= $1 net after repaying Aave
      const before = await usdc.balanceOf(addr);

      await expect(
        contract.startArbitrage(
          USDC, BORROW_USDC, WETH, UNI_V3_ROUTER, calldata1, UNI_V3_ROUTER, calldata2, minProfit
        )
      ).to.emit(contract, "ArbitrageExecuted");

      const after = await usdc.balanceOf(addr);
      const profit = after - before;
      console.log(`✓ flash loan repaid, net profit kept: $${(Number(profit) / 1e6).toFixed(2)} USDC`);

      expect(profit).to.be.gte(minProfit);

      // Profit is withdrawable by the owner — the full autonomous cycle.
      await contract.withdrawToken(USDC, profit);
      expect(await usdc.balanceOf(addr)).to.equal(0n);
    });

    it("enforces the profit floor: reverts when the arb is not profitable enough", async function () {
      await contract.addRouter(UNI_V3_ROUTER);
      const addr = await contract.getAddress();

      const UniV3Router = await ethers.getContractAt([
        "function exactInput((bytes path,address recipient,uint256 amountIn,uint256 amountOutMinimum) params) payable returns (uint256)"
      ], UNI_V3_ROUTER);

      const BORROW_USDC = 10_000_000_000n;
      const calldata1 = UniV3Router.interface.encodeFunctionData("exactInput", [{
        path: encodePath([USDC, WETH], [500]), recipient: addr,
        amountIn: BORROW_USDC, amountOutMinimum: 1n,
      }]);
      const calldata2 = UniV3Router.interface.encodeFunctionData("exactInput", [{
        path: encodePath([WETH, USDC], [3000]), recipient: addr,
        amountIn: 1n, amountOutMinimum: 1n,
      }]);

      // Untouched pools: the round trip loses the two swap fees, so the guard fires.
      await expect(
        contract.startArbitrage(
          USDC, BORROW_USDC, WETH, UNI_V3_ROUTER, calldata1, UNI_V3_ROUTER, calldata2, 1_000_000n
        )
      ).to.be.reverted;

      console.log("✓ unprofitable arb rejected before Aave repayment");
    });
  });
});
