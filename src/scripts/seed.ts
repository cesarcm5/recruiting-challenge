import { db, initSchema } from '../db.js';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../passwords.js';
import { merchantsDal } from '../dal/merchants-dal.js';

const MERCHANTS = [
  { id: 'm_acme', name: 'Acme Supplies', password: 'acme-dev-password' },
  { id: 'm_bistro', name: 'Bistro Verde', password: 'bistro-dev-password' },
];

const CUSTOMERS = [
  'ana@example.com',
  'bruno@example.com',
  'carla@example.com',
  'diego@example.com',
  'elena@example.com',
  'felipe@example.com',
];

function randomDateInLast90Days(): string {
  const now = Date.now();
  const offsetMs = Math.floor(Math.random() * 90 * 24 * 60 * 60 * 1000);
  return new Date(now - offsetMs).toISOString();
}

export function seedIfEmpty(): void {
  initSchema();

  const insertMerchant = db.prepare(
    `INSERT OR IGNORE INTO merchants (id, name) VALUES (?, ?)`,
  );
  for (const m of MERCHANTS) {
    insertMerchant.run(m.id, m.name);
    const existing = merchantsDal.getById(m.id);
    if (existing && !existing.password_hash) {
      merchantsDal.setPasswordHash(m.id, hashPassword(m.password));
    }
  }

  const existingOrders = db.prepare(`SELECT COUNT(*) AS n FROM orders`).get() as { n: number };
  if (existingOrders.n > 0) return;

  const insertOrder = db.prepare(
    `INSERT INTO orders (id, merchant_id, customer_email, total_amount, type, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  const insertMany = db.transaction(() => {
    for (let i = 0; i < 80; i++) {
      const merchant = MERCHANTS[i % MERCHANTS.length]!;
      const customer = CUSTOMERS[i % CUSTOMERS.length]!;
      const amount = Math.floor(2000 + Math.random() * 18000);
      const type: 'sale' | 'refund' = Math.random() < 0.15 ? 'refund' : 'sale';
      insertOrder.run(
        randomUUID(),
        merchant.id,
        customer,
        amount,
        type,
        'completed',
        randomDateInLast90Days(),
      );
    }
  });
  insertMany();
  console.log(`[seed] inserted ${MERCHANTS.length} merchants and 80 orders`);
}

const isMain = import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith(process.argv[1] ?? '');
if (isMain) {
  seedIfEmpty();
}
