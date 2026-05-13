// Set DB_PATH before importing the db module — the connection is created on import.
if (!process.env.DB_PATH) process.env.DB_PATH = ':memory:';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initSchema, db } from '../src/db.js';
import { ordersDal } from '../src/dal/orders-dal.js';

test('orders DAL: create + listByMerchant returns the order', () => {
  initSchema();
  db.prepare(`INSERT OR IGNORE INTO merchants (id, name) VALUES ('m_test', 'Test')`).run();
  const created = ordersDal.create({
    id: 'o1',
    merchant_id: 'm_test',
    customer_email: 'a@b.com',
    total_amount: 5000,
    type: 'sale',
    status: 'completed',
  });
  assert.equal(created.id, 'o1');
  const list = ordersDal.listByMerchant('m_test');
  assert.equal(list.length, 1);
  assert.equal(list[0]!.total_amount, 5000);
});

test('orders DAL: getById returns the order for the owning merchant', () => {
  initSchema();
  db.prepare(`INSERT OR IGNORE INTO merchants (id, name) VALUES ('m_test', 'Test')`).run();
  ordersDal.create({
    id: 'o2',
    merchant_id: 'm_test',
    customer_email: 'c@d.com',
    total_amount: 1200,
    type: 'sale',
    status: 'completed',
  });
  const got = ordersDal.getById('o2', 'm_test');
  assert.equal(got?.total_amount, 1200);
});

test('orders DAL: create a refund order for m_bistro', () => {
  initSchema();
  db.prepare(`INSERT OR IGNORE INTO merchants (id, name) VALUES ('m_bistro', 'Bistro Verde')`).run();
  const refund = ordersDal.create({
    id: 'o_refund_1',
    merchant_id: 'm_bistro',
    customer_email: 'diner@example.com',
    total_amount: 4200,
    type: 'refund',
    status: 'completed',
  });
  assert.equal(refund.merchant_id, 'm_bistro');
  assert.equal(refund.type, 'refund');
  assert.equal(refund.total_amount, 4200);

  const fetched = ordersDal.getById('o_refund_1', 'm_bistro');
  assert.equal(fetched?.type, 'refund');
});

test('orders DAL: create a second refund order for m_bistro (amount 200)', () => {
  initSchema();
  db.prepare(`INSERT OR IGNORE INTO merchants (id, name) VALUES ('m_bistro', 'Bistro Verde')`).run();
  const refund = ordersDal.create({
    id: 'o_refund_2',
    merchant_id: 'm_bistro',
    customer_email: 'diner2@example.com',
    total_amount: 200,
    type: 'refund',
    status: 'completed',
  });
  assert.equal(refund.merchant_id, 'm_bistro');
  assert.equal(refund.type, 'refund');
  assert.equal(refund.total_amount, 200);

  const fetched = ordersDal.getById('o_refund_2', 'm_bistro');
  assert.equal(fetched?.total_amount, 200);
});

test('orders DAL: sumAmountByMerchant subtracts refunds from sales', () => {
  initSchema();
  db.prepare(`INSERT OR IGNORE INTO merchants (id, name) VALUES ('m_rev', 'Revenue Test')`).run();
  db.prepare(`DELETE FROM orders WHERE merchant_id = 'm_rev'`).run();

  ordersDal.create({
    id: 'o_rev_sale_1', merchant_id: 'm_rev', customer_email: 'a@x.com',
    total_amount: 10000, type: 'sale', status: 'completed',
  });
  ordersDal.create({
    id: 'o_rev_sale_2', merchant_id: 'm_rev', customer_email: 'b@x.com',
    total_amount: 2500, type: 'sale', status: 'completed',
  });
  ordersDal.create({
    id: 'o_rev_refund_1', merchant_id: 'm_rev', customer_email: 'c@x.com',
    total_amount: 3000, type: 'refund', status: 'completed',
  });

  const from = '1970-01-01';
  const to = '2999-01-01';
  // sales 10000 + 2500 = 12500; refund 3000 → net 9500.
  // Naive SUM(total_amount) would return 15500 — this test pins the correct semantics.
  assert.equal(ordersDal.sumAmountByMerchant('m_rev', from, to), 9500);
});

test('orders DAL: sumAmountByMerchant respects the date range (half-open [from, to))', () => {
  initSchema();
  db.prepare(`INSERT OR IGNORE INTO merchants (id, name) VALUES ('m_rev2', 'Revenue Range Test')`).run();
  db.prepare(`DELETE FROM orders WHERE merchant_id = 'm_rev2'`).run();

  const insert = db.prepare(
    `INSERT INTO orders (id, merchant_id, customer_email, total_amount, type, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  // Before the window — must be excluded
  insert.run('o_before', 'm_rev2', 'x@x.com', 9999, 'sale', 'completed', '2025-12-31');
  // Inside the window
  insert.run('o_in_sale', 'm_rev2', 'x@x.com', 8000, 'sale', 'completed', '2026-01-15');
  insert.run('o_in_refund', 'm_rev2', 'x@x.com', 1500, 'refund', 'completed', '2026-01-20');
  // On the exclusive upper bound — must be excluded
  insert.run('o_at_to', 'm_rev2', 'x@x.com', 7777, 'sale', 'completed', '2026-02-01');
  // After the window — must be excluded
  insert.run('o_after', 'm_rev2', 'x@x.com', 5555, 'sale', 'completed', '2026-03-01');

  const total = ordersDal.sumAmountByMerchant('m_rev2', '2026-01-01', '2026-02-01');
  // Only the two January rows count: 8000 sale − 1500 refund = 6500.
  assert.equal(total, 6500);
});

test('orders DAL: getById is tenant-scoped — a different merchant cannot read the order', () => {
  initSchema();
  db.prepare(`INSERT OR IGNORE INTO merchants (id, name) VALUES ('m_owner', 'Owner')`).run();
  db.prepare(`INSERT OR IGNORE INTO merchants (id, name) VALUES ('m_other', 'Other')`).run();
  ordersDal.create({
    id: 'o_secret',
    merchant_id: 'm_owner',
    customer_email: 'secret@x.com',
    total_amount: 9999,
    type: 'sale',
    status: 'completed',
  });
  assert.equal(ordersDal.getById('o_secret', 'm_owner')?.total_amount, 9999);
  assert.equal(ordersDal.getById('o_secret', 'm_other'), undefined);
});
