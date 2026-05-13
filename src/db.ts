import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const DB_PATH = process.env.DB_PATH ?? 'data/dashboard.db';

if (!existsSync(dirname(DB_PATH))) {
  mkdirSync(dirname(DB_PATH), { recursive: true });
}

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS merchants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      password_hash TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL REFERENCES merchants(id),
      customer_email TEXT NOT NULL,
      total_amount INTEGER NOT NULL,
      type TEXT NOT NULL DEFAULT 'sale',
      status TEXT NOT NULL DEFAULT 'completed',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_orders_merchant ON orders(merchant_id);
    CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);

    CREATE TABLE IF NOT EXISTS webhook_subscriptions (
      id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL REFERENCES merchants(id),
      url TEXT NOT NULL,
      secret TEXT NOT NULL,
      event_types TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_webhook_subs_merchant ON webhook_subscriptions(merchant_id);

    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id TEXT PRIMARY KEY,
      subscription_id TEXT NOT NULL REFERENCES webhook_subscriptions(id),
      merchant_id TEXT NOT NULL REFERENCES merchants(id),
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT NOT NULL,
      last_error TEXT,
      response_status INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      delivered_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_deliveries_pending
      ON webhook_deliveries(status, next_attempt_at)
      WHERE status = 'pending';
  `);

  const merchantCols = db
    .prepare(`PRAGMA table_info(merchants)`)
    .all() as Array<{ name: string }>;
  if (!merchantCols.some((c) => c.name === 'password_hash')) {
    db.exec(`ALTER TABLE merchants ADD COLUMN password_hash TEXT`);
  }

  const orderCols = db
    .prepare(`PRAGMA table_info(orders)`)
    .all() as Array<{ name: string }>;
  if (!orderCols.some((c) => c.name === 'refunded_order_id')) {
    db.exec(`ALTER TABLE orders ADD COLUMN refunded_order_id TEXT REFERENCES orders(id)`);
  }
}
