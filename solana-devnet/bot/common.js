// Shared plumbing for the devnet bot: connection, wallet, PDAs, instruction
// builders and the constant-product maths the on-chain pools use.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  Connection, Keypair, PublicKey, SystemProgram, SYSVAR_INSTRUCTIONS_PUBKEY,
  TransactionInstruction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

const here = path.dirname(fileURLToPath(import.meta.url));

export const RPC = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
// ARBITER_PROGRAM_ID selects the Pinocchio build (programs-lite); it speaks the
// same instructions, so every builder below works unchanged.
export const PROGRAM_ID = new PublicKey(process.env.ARBITER_PROGRAM_ID || "C1RWmeDJxaLciy6puyjxWMWFBbo5DWSTtGWaMsvVdFF1");
// Pools live in the Anchor program; the lite build has none on mainnet, where
// swaps go to a real DEX. POOL_PROGRAM_ID keeps devnet swaps pointed there.
export const POOL_PROGRAM_ID = new PublicKey(process.env.POOL_PROGRAM_ID || "C1RWmeDJxaLciy6puyjxWMWFBbo5DWSTtGWaMsvVdFF1");
export const connection = new Connection(RPC, "confirmed");
export const STATE_PATH = process.env.ARBITER_STATE || path.join(here, "state.json");
export const LOG_PATH = path.join(here, "trades.jsonl");

export function loadBot() {
  const file = process.env.BOT_KEYPAIR || path.join(here, "bot-keypair.json");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(file, "utf8"))));
}

export function loadState() {
  if (!existsSync(STATE_PATH)) throw new Error("state.json missing — run `node setup.js` first");
  const raw = JSON.parse(readFileSync(STATE_PATH, "utf8"));
  const pk = (k) => new PublicKey(raw[k]);
  return { raw, mintA: pk("mintA"), mintB: pk("mintB"), botA: pk("botA"), botB: pk("botB") };
}

export function saveState(obj) {
  writeFileSync(STATE_PATH, JSON.stringify(obj, null, 2));
}

export const explorer = (sig) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

// ── PDAs ────────────────────────────────────────────────────────────────────
const pdaOf = (pid, seeds) => PublicKey.findProgramAddressSync(seeds, pid)[0];
const pda = (...seeds) => pdaOf(PROGRAM_ID, seeds);
const poolDa = (...seeds) => pdaOf(POOL_PROGRAM_ID, seeds);
export const vaultPda = (mint) => pda(Buffer.from("vault"), mint.toBuffer());
export const vaultTokensPda = (vault) => pda(Buffer.from("vault_tokens"), vault.toBuffer());
export const poolPda = (id) => poolDa(Buffer.from("pool"), Buffer.from([id]));
export const reserveA = (pool) => poolDa(Buffer.from("res_a"), pool.toBuffer());
export const reserveB = (pool) => poolDa(Buffer.from("res_b"), pool.toBuffer());

// ── Instruction encoding (Anchor: sha256("global:<name>")[..8] + borsh args) ─
const disc = (name) => createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const m = (pubkey, isSigner, isWritable) => ({ pubkey, isSigner, isWritable });
const ixFor = (programId) => (name, keys, ...args) =>
  new TransactionInstruction({ programId, keys, data: Buffer.concat([disc(name), ...args]) });
const ix = ixFor(PROGRAM_ID);
const poolIx = ixFor(POOL_PROGRAM_ID);

export function initVaultIx(payer, mint, feeBps) {
  const vault = vaultPda(mint);
  return ix("init_vault", [
    m(payer, true, true), m(mint, false, false), m(vault, false, true),
    m(vaultTokensPda(vault), false, true), m(TOKEN_PROGRAM_ID, false, false),
    m(SystemProgram.programId, false, false),
  ], u16(feeBps));
}

export function depositIx(depositor, depositorToken, mint, amount) {
  const vault = vaultPda(mint);
  return ix("deposit", [
    m(depositor, true, false), m(depositorToken, false, true), m(vault, false, false),
    m(vaultTokensPda(vault), false, true), m(TOKEN_PROGRAM_ID, false, false),
  ], u64(amount));
}

export function initPoolIx(payer, mintA, mintB, id, feeBps) {
  const pool = poolPda(id);
  return poolIx("init_pool", [
    m(payer, true, true), m(mintA, false, false), m(mintB, false, false), m(pool, false, true),
    m(reserveA(pool), false, true), m(reserveB(pool), false, true),
    m(TOKEN_PROGRAM_ID, false, false), m(SystemProgram.programId, false, false),
  ], Buffer.from([id]), u16(feeBps));
}

export function addLiquidityIx(provider, provA, provB, id, amountA, amountB) {
  const pool = poolPda(id);
  return poolIx("add_liquidity", [
    m(provider, true, false), m(provA, false, true), m(provB, false, true), m(pool, false, false),
    m(reserveA(pool), false, true), m(reserveB(pool), false, true), m(TOKEN_PROGRAM_ID, false, false),
  ], u64(amountA), u64(amountB));
}

export function swapIx(user, userA, userB, id, aToB, amountIn, minOut) {
  const pool = poolPda(id);
  return poolIx("swap", [
    m(user, true, false), m(userA, false, true), m(userB, false, true), m(pool, false, false),
    m(reserveA(pool), false, true), m(reserveB(pool), false, true), m(TOKEN_PROGRAM_ID, false, false),
  ], Buffer.from([aToB ? 1 : 0]), u64(amountIn), u64(minOut));
}

export function flashBorrowIx(borrower, borrowerToken, mint, amount) {
  const vault = vaultPda(mint);
  return ix("flash_borrow", [
    m(borrower, true, false), m(borrowerToken, false, true), m(vault, false, true),
    m(vaultTokensPda(vault), false, true), m(SYSVAR_INSTRUCTIONS_PUBKEY, false, false),
    m(TOKEN_PROGRAM_ID, false, false),
  ], u64(amount));
}

export function flashRepayIx(borrower, borrowerToken, mint, amount) {
  const vault = vaultPda(mint);
  return ix("flash_repay", [
    m(borrower, true, false), m(borrowerToken, false, true), m(vault, false, true),
    m(vaultTokensPda(vault), false, true), m(TOKEN_PROGRAM_ID, false, false),
  ], u64(amount));
}

// ── Maths mirrored from the program ─────────────────────────────────────────
export const POOL_FEE_BPS = 30n;
export const LOAN_FEE_BPS = 9n;
export const swapOut = (amountIn, rIn, rOut, feeBps = POOL_FEE_BPS) => {
  const inFee = amountIn * (10_000n - feeBps);
  return (inFee * rOut) / (rIn * 10_000n + inFee);
};
export const loanFee = (amount) => (amount * LOAN_FEE_BPS + 9_999n) / 10_000n;

export async function tokenBalance(account) {
  const r = await connection.getTokenAccountBalance(account, "confirmed");
  return BigInt(r.value.amount);
}

export async function poolReserves(id) {
  const pool = poolPda(id);
  const [a, b] = await Promise.all([tokenBalance(reserveA(pool)), tokenBalance(reserveB(pool))]);
  return { a, b };
}

export const fmt = (n, decimals = 6) => (Number(n) / 10 ** decimals).toLocaleString("en-US", { maximumFractionDigits: 4 });
