#!/usr/bin/env node
// One-time schema init — run locally: node scripts/init-db.mjs
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { neon } = require("../dashboard-web/node_modules/@neondatabase/serverless/index.js");

const DB = process.env.DATABASE_URL ??
  "postgresql://neondb_owner:npg_MLd9e6hQmgZa@ep-purple-cloud-aoc9zpro-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb?channel_binding=require&sslmode=require";

const sql = neon(DB);

console.log("Initializing Neon schema...");

await sql`
  CREATE TABLE IF NOT EXISTS bot_stats (
    id              SERIAL PRIMARY KEY,
    mode            VARCHAR(10)    NOT NULL DEFAULT 'paper',
    bankroll_usd    NUMERIC(12,2)  NOT NULL DEFAULT 1000.00,
    realized_pnl_today  NUMERIC(12,2) NOT NULL DEFAULT 0,
    realized_pnl_total  NUMERIC(12,2) NOT NULL DEFAULT 0,
    win_rate            NUMERIC(6,4)  NOT NULL DEFAULT 0,
    avg_edge_pct        NUMERIC(6,4)  NOT NULL DEFAULT 0,
    kill_switch_active  BOOLEAN       NOT NULL DEFAULT false,
    daily_loss_pct      NUMERIC(6,4)  NOT NULL DEFAULT 0,
    open_positions      INTEGER       NOT NULL DEFAULT 0,
    max_open_positions  INTEGER       NOT NULL DEFAULT 5,
    trades_today        INTEGER       NOT NULL DEFAULT 0,
    opportunities_found_today INTEGER NOT NULL DEFAULT 0,
    last_scan_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    uptime_hours    NUMERIC(10,2)  NOT NULL DEFAULT 0,
    started_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    consecutive_api_failures INTEGER NOT NULL DEFAULT 0
  )
`;
console.log("✓ bot_stats");

await sql`
  CREATE TABLE IF NOT EXISTS trades (
    id            VARCHAR(80)   PRIMARY KEY,
    timestamp     TIMESTAMPTZ   NOT NULL,
    market_id     VARCHAR(255)  NOT NULL,
    description   TEXT          NOT NULL DEFAULT '',
    strategy      VARCHAR(100)  NOT NULL DEFAULT '',
    venue         VARCHAR(100)  NOT NULL DEFAULT '',
    sets          NUMERIC(12,4) NOT NULL DEFAULT 0,
    notional_usd  NUMERIC(12,2) NOT NULL DEFAULT 0,
    locked_profit NUMERIC(12,2) NOT NULL DEFAULT 0,
    fill_pct      NUMERIC(6,4)  NOT NULL DEFAULT 1,
    note          TEXT          NOT NULL DEFAULT '',
    mode          VARCHAR(10)   NOT NULL DEFAULT 'paper',
    edge_pct      NUMERIC(6,4)  NOT NULL DEFAULT 0
  )
`;
console.log("✓ trades");

await sql`
  CREATE TABLE IF NOT EXISTS equity_history (
    id          SERIAL        PRIMARY KEY,
    date        DATE          NOT NULL,
    equity      NUMERIC(12,2) NOT NULL,
    pnl         NUMERIC(12,2) NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    UNIQUE(date)
  )
`;
console.log("✓ equity_history");

await sql`
  CREATE TABLE IF NOT EXISTS opportunities (
    id          SERIAL        PRIMARY KEY,
    market_id   VARCHAR(255)  NOT NULL,
    question    TEXT          NOT NULL,
    edge_pct    NUMERIC(6,4)  NOT NULL,
    implied_prob_yes NUMERIC(6,4),
    implied_prob_no  NUMERIC(6,4),
    depth_usd   NUMERIC(12,2),
    strategy    VARCHAR(100),
    venue       VARCHAR(100),
    detected_at TIMESTAMPTZ   NOT NULL,
    is_active   BOOLEAN       NOT NULL DEFAULT true,
    UNIQUE(market_id, detected_at)
  )
`;
console.log("✓ opportunities");

// Seed initial bot_stats row
await sql`INSERT INTO bot_stats (id) VALUES (1) ON CONFLICT (id) DO NOTHING`;
console.log("✓ bot_stats row 1 seeded");

// Seed today's equity point
await sql`
  INSERT INTO equity_history (date, equity, pnl)
  VALUES (CURRENT_DATE, 1000.00, 0)
  ON CONFLICT (date) DO NOTHING
`;
console.log("✓ equity seeded");

// Verify
const tables = await sql`
  SELECT tablename FROM pg_tables
  WHERE schemaname = 'public'
  ORDER BY tablename
`;
console.log("\nTables in database:", tables.map(r => r.tablename).join(", "));
console.log("\nSchema initialized successfully.");
