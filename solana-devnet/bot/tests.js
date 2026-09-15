// On-chain proof tests against devnet. Every "must fail" case is sent with
// skipPreflight so it lands and fails ON CHAIN with a signature anyone can
// open, rather than being stopped by a local simulation.
//
// The borrower is a brand-new wallet holding 0 tUSD, so nothing but the trade
// itself can cover principal + fee.
import {
  Keypair, SystemProgram, Transaction, ComputeBudgetProgram, sendAndConfirmTransaction,
} from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import {
  connection, loadBot, loadState, poolReserves, swapOut, loanFee, tokenBalance, explorer, fmt,
  flashBorrowIx, flashRepayIx, swapIx, vaultPda, vaultTokensPda,
} from "./common.js";

const bot = loadBot();
const st = loadState();
const vaultTokens = vaultTokensPda(vaultPda(st.mintA));
const results = [];

const fresh = Keypair.generate();
await sendAndConfirmTransaction(connection, new Transaction().add(
  SystemProgram.transfer({ fromPubkey: bot.publicKey, toPubkey: fresh.publicKey, lamports: 50_000_000 })), [bot]);
const fA = (await getOrCreateAssociatedTokenAccount(connection, bot, st.mintA, fresh.publicKey)).address;
const fB = (await getOrCreateAssociatedTokenAccount(connection, bot, st.mintB, fresh.publicKey)).address;
console.log(`fresh borrower ${fresh.publicKey.toBase58()}  tUSD=${fmt(await tokenBalance(fA))}`);

async function expectFailOnChain(name, ixs) {
  const vaultBefore = await tokenBalance(vaultTokens);
  const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...ixs);
  tx.feePayer = fresh.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.sign(fresh);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  await connection.confirmTransaction(sig, "confirmed").catch(() => {});
  let meta = null;
  for (let i = 0; i < 20 && !meta; i++) {
    meta = (await connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }))?.meta;
    if (!meta) await new Promise((r) => setTimeout(r, 1500));
  }
  const vaultAfter = await tokenBalance(vaultTokens);
  const failed = !!meta?.err;
  const why = (meta?.logMessages || []).filter((l) => /Error|failed|insufficient/i.test(l)).slice(-2).join(" / ");
  const pass = failed && vaultAfter === vaultBefore;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}\n      on-chain error: ${why}\n      vault ${fmt(vaultBefore)} → ${fmt(vaultAfter)} tUSD\n      ${explorer(sig)}`);
  results.push({ name, pass, sig, why });
}

// 1. Borrow with no repay in the transaction → program refuses to lend.
await expectFailOnChain("flash_borrow without flash_repay is refused", [
  flashBorrowIx(fresh.publicKey, fA, st.mintA, 1_000_000_000n),
]);

// 2. Unprofitable round trip on ONE pool (pays two swap fees) → repay short → full revert.
{
  const x = 1_000_000_000n; // 1,000 tUSD
  const p0 = await poolReserves(0);
  const b = swapOut(x, p0.a, p0.b);
  await expectFailOnChain("unprofitable arb reverts, loan included", [
    flashBorrowIx(fresh.publicKey, fA, st.mintA, x),
    swapIx(fresh.publicKey, fA, fB, 0, true, x, 1n),
    swapIx(fresh.publicKey, fA, fB, 0, false, b, 1n),
    flashRepayIx(fresh.publicKey, fA, st.mintA, x),
  ]);
}

// 3. Profitable cross-pool arb from a 0-balance wallet → succeeds, profit stays with borrower.
{
  const [p0, p1] = await Promise.all([poolReserves(0), poolReserves(1)]);
  const cheap0 = Number(p0.a) / Number(p0.b) <= Number(p1.a) / Number(p1.b);
  const [c, d, cid, did] = cheap0 ? [p0, p1, 0, 1] : [p1, p0, 1, 0];
  const x = 2_000_000_000n; // 2,000 tUSD
  const b = swapOut(x, c.a, c.b), back = swapOut(b, d.b, d.a), net = back - x - loanFee(x);
  if (net <= 0n) {
    console.log(`SKIP  profitable arb: pools currently in line (expected net ${fmt(net)}) — run bot.js --noise first`);
    results.push({ name: "profitable arb from 0-balance wallet", pass: null });
  } else {
    const vaultBefore = await tokenBalance(vaultTokens);
    const sig = await sendAndConfirmTransaction(connection, new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      flashBorrowIx(fresh.publicKey, fA, st.mintA, x),
      swapIx(fresh.publicKey, fA, fB, cid, true, x, b),
      swapIx(fresh.publicKey, fA, fB, did, false, b, back),
      flashRepayIx(fresh.publicKey, fA, st.mintA, x),
    ), [fresh]);
    const got = await tokenBalance(fA), vaultAfter = await tokenBalance(vaultTokens);
    const pass = got > 0n && vaultAfter - vaultBefore === loanFee(x);
    console.log(`${pass ? "PASS" : "FAIL"}  profitable arb from 0-balance wallet: borrowed ${fmt(x)}, kept +${fmt(got)} tUSD, vault earned ${fmt(vaultAfter - vaultBefore)} fee\n      ${explorer(sig)}`);
    results.push({ name: "profitable arb from 0-balance wallet", pass, sig, profit: fmt(got) });
  }
}

const failed = results.filter((r) => r.pass === false).length;
console.log(`\n${results.filter((r) => r.pass).length} passed, ${failed} failed, ${results.filter((r) => r.pass === null).length} skipped`);
process.exit(failed ? 1 : 0);
