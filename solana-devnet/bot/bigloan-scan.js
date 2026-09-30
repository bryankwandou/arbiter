// Dry run, no transactions: would a large flash loan (MarginFi 0% / Kamino
// ~0.001% / our vault 0.09%) round-trip profitably through the suggested pairs?
// Uses Jupiter's expected output (best route across Raydium, Orca, Meteora…).
//   node bigloan-scan.js [rounds]
import { appendFileSync } from "node:fs";

const JUP = "https://lite-api.jup.ag/swap/v1";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const T = {
  SOL: "So11111111111111111111111111111111111111112", USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  JTO: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL", JUP: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
  RAY: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R", BONK: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  WIF: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
};
const SIZES = (process.env.SIZES || "100,1000,10000,50000").split(",").map(Number);                      // USDC
const FEES = { marginfi: 0, kamino: 0.1, "our vault": 9 };    // bps
const TX_COST_USD = 0.01;                                      // base + priority fee, generous

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function q(inM, outM, amt) {
  for (let i = 0; i < 4; i++) {
    await sleep(2500);
    const r = await fetch(`${JUP}/quote?inputMint=${inM}&outputMint=${outM}&amount=${amt}&slippageBps=0`);
    if (r.status === 429) { await sleep(10000); continue; }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return BigInt((await r.json()).outAmount);
  }
  throw new Error("rate limited");
}

const routes = [
  ...["SOL", "USDT", "JTO", "JUP", "RAY", "BONK", "WIF"].map((m) => [m]),
  ...["JTO", "JUP", "RAY", "BONK", "WIF"].map((m) => ["SOL", m]), // triangles USDC→SOL→X→USDC
];
const rounds = Number(process.argv[2] || 1);
let best = null;
for (let round = 1; round <= rounds; round++) {
  for (const usd of SIZES) {
    for (const path of routes) {
      const amt = BigInt(usd) * 1_000_000n;
      try {
        let x = amt, prev = USDC;
        for (const m of path) { x = await q(prev, T[m], x); prev = T[m]; }
        x = await q(prev, USDC, x);
        const gross = Number(x - amt) / 1e6;
        const bps = (gross / usd) * 1e4;
        const nets = Object.fromEntries(Object.entries(FEES).map(([k, f]) => [k, +(gross - usd * f / 1e4 - TX_COST_USD).toFixed(4)]));
        const line = { t: new Date().toISOString(), size: usd, path: ["USDC", ...path, "USDC"].join("→"), gross: +gross.toFixed(4), bps: +bps.toFixed(1), net: nets };
        console.log(`${line.path.padEnd(20)} ${String(usd).padStart(6)} USDC  gross ${bps.toFixed(1).padStart(6)} bps  net marginfi ${nets.marginfi}`);
        appendFileSync(new URL("./bigloan-scan.jsonl", import.meta.url), JSON.stringify(line) + "\n");
        if (!best || nets.marginfi > best.net.marginfi) best = line;
      } catch (e) { console.log(`${path.join("→")} ${usd}: ${e.message}`); }
    }
  }
}
console.log("\nBEST:", JSON.stringify(best));
