// One-time devnet setup: two test mints, a funded flash-loan vault, and two
// pools quoting the same pair at different prices (100 vs 104 tUSD per tSOL).
// The gap is put there on purpose so the bot has something to find; it is a
// mechanism test, not a market.
import { Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import {
  connection, loadBot, saveState, initVaultIx, depositIx, initPoolIx, addLiquidityIx, explorer,
} from "./common.js";

const D = 1_000_000n; // 6 decimals
const bot = loadBot();
const send = async (label, ...ixs) => {
  const sig = await sendAndConfirmTransaction(connection, new Transaction().add(...ixs), [bot]);
  console.log(`${label}: ${explorer(sig)}`);
  return sig;
};

const mintA = await createMint(connection, bot, bot.publicKey, null, 6); // tUSD
const mintB = await createMint(connection, bot, bot.publicKey, null, 6); // tSOL
console.log("mint tUSD", mintA.toBase58(), "\nmint tSOL", mintB.toBase58());
const botA = (await getOrCreateAssociatedTokenAccount(connection, bot, mintA, bot.publicKey)).address;
const botB = (await getOrCreateAssociatedTokenAccount(connection, bot, mintB, bot.publicKey)).address;
await mintTo(connection, bot, mintA, botA, bot, 5_000_000n * D);
await mintTo(connection, bot, mintB, botB, bot, 50_000n * D);

await send("init vault (0.09% loan fee)", initVaultIx(bot.publicKey, mintA, 9));
await send("deposit 1,000,000 tUSD into vault", depositIx(bot.publicKey, botA, mintA, 1_000_000n * D));
await send("init pool 0 + pool 1 (0.30% fee)", initPoolIx(bot.publicKey, mintA, mintB, 0, 30), initPoolIx(bot.publicKey, mintA, mintB, 1, 30));
await send("pool 0: 1,000,000 tUSD / 10,000 tSOL (price 100)", addLiquidityIx(bot.publicKey, botA, botB, 0, 1_000_000n * D, 10_000n * D));
await send("pool 1: 1,040,000 tUSD / 10,000 tSOL (price 104)", addLiquidityIx(bot.publicKey, botA, botB, 1, 1_040_000n * D, 10_000n * D));

saveState({ mintA: mintA.toBase58(), mintB: mintB.toBase58(), botA: botA.toBase58(), botB: botB.toBase58() });
console.log("state.json written");
