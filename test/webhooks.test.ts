if (!process.env.DB_PATH) process.env.DB_PATH = ':memory:';
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'test-secret-test-secret-test-secret';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http, { type Server as HttpServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { initSchema, db } from '../src/db.js';
import { hashPassword } from '../src/passwords.js';
import { signAccessToken, authMiddleware } from '../src/auth.js';
import { ordersDal } from '../src/dal/orders-dal.js';
import { webhookSubscriptionsRouter } from '../src/routes/webhook-subscriptions.js';
import { tick } from '../src/webhooks/dispatcher.js';
import { sign, verifySignature } from '../src/webhooks/verify.js';

let apiServer: HttpServer;
let baseUrl: string;
let tokenA: string;
let tokenB: string;

before(async () => {
  initSchema();
  db.prepare(`INSERT OR IGNORE INTO merchants (id, name) VALUES ('m_a', 'A')`).run();
  db.prepare(`INSERT OR IGNORE INTO merchants (id, name) VALUES ('m_b', 'B')`).run();
  db.prepare(`UPDATE merchants SET password_hash = ? WHERE id = 'm_a'`).run(hashPassword('pw'));
  db.prepare(`UPDATE merchants SET password_hash = ? WHERE id = 'm_b'`).run(hashPassword('pw'));

  tokenA = signAccessToken('m_a').token;
  tokenB = signAccessToken('m_b').token;

  const app = express();
  app.use(express.json());
  app.use('/api/webhook-subscriptions', authMiddleware, webhookSubscriptionsRouter);

  await new Promise<void>((resolve) => {
    apiServer = app.listen(0, () => resolve());
  });
  const addr = apiServer.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => apiServer.close(() => resolve()));
});

function authHeaders(token: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function createSub(token: string, url: string, eventTypes: string[] = ['order.created', 'order.refunded']) {
  const res = await fetch(`${baseUrl}/api/webhook-subscriptions`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ url, event_types: eventTypes }),
  });
  return { status: res.status, body: (await res.json()) as { subscription?: { id: string }; secret?: string; error?: string } };
}

type CapturedRequest = { headers: http.IncomingHttpHeaders; body: string };

function startReceiver(handler: (req: CapturedRequest) => { status: number }): Promise<{ url: string; received: CapturedRequest[]; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const received: CapturedRequest[] = [];
    const srv = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        const captured: CapturedRequest = { headers: req.headers, body };
        received.push(captured);
        const { status } = handler(captured);
        res.writeHead(status);
        res.end();
      });
    });
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${addr.port}/hook`,
        received,
        close: () => new Promise((r) => srv.close(() => r())),
      });
    });
  });
}

// ---------- Tests 1–7: routes + outbox + dispatcher ----------

test('1. POST /api/webhook-subscriptions validates URL', async () => {
  const httpsOk = await createSub(tokenA, 'https://example.com/hook');
  assert.equal(httpsOk.status, 201);

  const httpRejected = await createSub(tokenA, 'http://example.com/hook');
  assert.equal(httpRejected.status, 400);
  assert.equal(httpRejected.body.error, 'url_must_be_https');

  const localhostOk = await createSub(tokenA, 'http://localhost:9999/hook');
  assert.equal(localhostOk.status, 201);

  const malformed = await createSub(tokenA, 'not-a-url');
  assert.equal(malformed.status, 400);
});

test('2. POST returns secret; subsequent GET does not include it', async () => {
  const created = await createSub(tokenA, 'https://example.com/secret-test');
  assert.equal(created.status, 201);
  assert.ok(typeof created.body.secret === 'string' && created.body.secret.length === 64);

  const listRes = await fetch(`${baseUrl}/api/webhook-subscriptions`, {
    headers: authHeaders(tokenA),
  });
  const list = (await listRes.json()) as { subscriptions: Array<Record<string, unknown>> };
  for (const sub of list.subscriptions) {
    assert.equal('secret' in sub, false);
  }
});

test('3. Tenant scoping: GET/DELETE another merchants subscription returns 404', async () => {
  const created = await createSub(tokenA, 'https://example.com/tenant-test');
  assert.equal(created.status, 201);
  const subId = created.body.subscription!.id;

  const otherGet = await fetch(`${baseUrl}/api/webhook-subscriptions/${subId}/deliveries`, {
    headers: authHeaders(tokenB),
  });
  assert.equal(otherGet.status, 404);

  const otherDelete = await fetch(`${baseUrl}/api/webhook-subscriptions/${subId}`, {
    method: 'DELETE',
    headers: authHeaders(tokenB),
  });
  assert.equal(otherDelete.status, 404);

  // owner can still delete
  const ownerDelete = await fetch(`${baseUrl}/api/webhook-subscriptions/${subId}`, {
    method: 'DELETE',
    headers: authHeaders(tokenA),
  });
  assert.equal(ownerDelete.status, 204);
});

test('4. Order create and webhook enqueue commit in the same transaction', async () => {
  db.prepare(`DELETE FROM webhook_deliveries WHERE merchant_id = 'm_a'`).run();
  db.prepare(`DELETE FROM webhook_subscriptions WHERE merchant_id = 'm_a'`).run();
  db.prepare(`DELETE FROM orders WHERE merchant_id = 'm_a'`).run();

  await createSub(tokenA, 'https://example.com/outbox-test', ['order.created']);

  // Happy path: order INSERT succeeds, delivery row exists.
  ordersDal.create({
    id: 'ord_ok',
    merchant_id: 'm_a',
    customer_email: 'x@y.com',
    total_amount: 1000,
    type: 'sale',
    status: 'completed',
  });
  const deliveriesAfterOk = db
    .prepare(`SELECT COUNT(*) AS n FROM webhook_deliveries WHERE merchant_id = 'm_a'`)
    .get() as { n: number };
  assert.equal(deliveriesAfterOk.n, 1);

  // Failure path: order INSERT fails (FK violation on merchant_id). Nothing leaks.
  const deliveriesBefore = db
    .prepare(`SELECT COUNT(*) AS n FROM webhook_deliveries`)
    .get() as { n: number };
  assert.throws(() =>
    ordersDal.create({
      id: 'ord_bad',
      merchant_id: 'm_does_not_exist',
      customer_email: 'x@y.com',
      total_amount: 500,
      type: 'sale',
      status: 'completed',
    }),
  );
  const orderAfter = db.prepare(`SELECT * FROM orders WHERE id = 'ord_bad'`).get();
  assert.equal(orderAfter, undefined);
  const deliveriesAfter = db
    .prepare(`SELECT COUNT(*) AS n FROM webhook_deliveries`)
    .get() as { n: number };
  assert.equal(deliveriesAfter.n, deliveriesBefore.n);
});

test('5. tick() delivers a pending event with a valid HMAC signature', async () => {
  db.prepare(`DELETE FROM webhook_deliveries WHERE merchant_id = 'm_a'`).run();
  db.prepare(`DELETE FROM webhook_subscriptions WHERE merchant_id = 'm_a'`).run();
  db.prepare(`DELETE FROM orders WHERE merchant_id = 'm_a'`).run();

  const receiver = await startReceiver(() => ({ status: 200 }));

  const created = await createSub(tokenA, receiver.url, ['order.created']);
  const secret = created.body.secret!;

  ordersDal.create({
    id: 'ord_tick_ok',
    merchant_id: 'm_a',
    customer_email: 'x@y.com',
    total_amount: 1234,
    type: 'sale',
    status: 'completed',
  });

  await tick();

  assert.equal(receiver.received.length, 1);
  const req = receiver.received[0]!;
  const sigHeader = req.headers['x-t1-signature'];
  assert.ok(typeof sigHeader === 'string' && sigHeader.startsWith('sha256='));
  assert.equal(verifySignature(req.body, secret, sigHeader), true);

  const envelope = JSON.parse(req.body) as { id: string; type: string; api_version: string; data: { id: string; type: string } };
  assert.ok(envelope.id.startsWith('evt_'));
  assert.equal(envelope.type, 'order.created');
  assert.equal(envelope.data.id, 'ord_tick_ok');

  const row = db
    .prepare(`SELECT status, attempts FROM webhook_deliveries WHERE merchant_id = 'm_a'`)
    .get() as { status: string; attempts: number };
  assert.equal(row.status, 'delivered');
  assert.equal(row.attempts, 1);

  await receiver.close();
});

test('6. tick() failure increments attempts and schedules next attempt ~30s out', async () => {
  db.prepare(`DELETE FROM webhook_deliveries WHERE merchant_id = 'm_a'`).run();
  db.prepare(`DELETE FROM webhook_subscriptions WHERE merchant_id = 'm_a'`).run();
  db.prepare(`DELETE FROM orders WHERE merchant_id = 'm_a'`).run();

  const receiver = await startReceiver(() => ({ status: 500 }));

  await createSub(tokenA, receiver.url, ['order.created']);

  const before = Date.now();
  ordersDal.create({
    id: 'ord_tick_fail',
    merchant_id: 'm_a',
    customer_email: 'x@y.com',
    total_amount: 1234,
    type: 'sale',
    status: 'completed',
  });

  await tick();

  const row = db
    .prepare(`SELECT status, attempts, last_error, response_status, next_attempt_at FROM webhook_deliveries WHERE merchant_id = 'm_a'`)
    .get() as { status: string; attempts: number; last_error: string; response_status: number; next_attempt_at: string };
  assert.equal(row.status, 'pending');
  assert.equal(row.attempts, 1);
  assert.equal(row.response_status, 500);
  assert.ok(row.last_error.includes('500'));
  const nextMs = new Date(row.next_attempt_at).getTime();
  assert.ok(nextMs >= before + 30_000 - 2_000 && nextMs <= before + 30_000 + 5_000);

  await receiver.close();
});

test('7. After 5 failed attempts the delivery is marked failed and not retried', async () => {
  db.prepare(`DELETE FROM webhook_deliveries WHERE merchant_id = 'm_a'`).run();
  db.prepare(`DELETE FROM webhook_subscriptions WHERE merchant_id = 'm_a'`).run();
  db.prepare(`DELETE FROM orders WHERE merchant_id = 'm_a'`).run();

  const receiver = await startReceiver(() => ({ status: 500 }));
  await createSub(tokenA, receiver.url, ['order.created']);

  ordersDal.create({
    id: 'ord_max',
    merchant_id: 'm_a',
    customer_email: 'x@y.com',
    total_amount: 1,
    type: 'sale',
    status: 'completed',
  });

  for (let i = 0; i < 5; i++) {
    db.prepare(`UPDATE webhook_deliveries SET next_attempt_at = ? WHERE merchant_id = 'm_a'`).run(
      new Date(Date.now() - 1000).toISOString(),
    );
    await tick();
  }

  const row = db
    .prepare(`SELECT status, attempts FROM webhook_deliveries WHERE merchant_id = 'm_a'`)
    .get() as { status: string; attempts: number };
  assert.equal(row.status, 'failed');
  assert.equal(row.attempts, 5);
  assert.equal(receiver.received.length, 5);

  // Sixth tick must be a no-op for this delivery.
  db.prepare(`UPDATE webhook_deliveries SET next_attempt_at = ? WHERE merchant_id = 'm_a'`).run(
    new Date(Date.now() - 1000).toISOString(),
  );
  await tick();
  assert.equal(receiver.received.length, 5);

  await receiver.close();
});

// ---------- Tests 8–12: verifySignature ----------

test('8. verifySignature accepts a body signed with the matching secret', () => {
  const body = JSON.stringify({ hello: 'world' });
  const secret = 'sek';
  const header = `sha256=${sign(body, secret)}`;
  assert.equal(verifySignature(body, secret, header), true);
});

test('9. verifySignature rejects when the secret does not match', () => {
  const body = JSON.stringify({ hello: 'world' });
  const header = `sha256=${sign(body, 'right')}`;
  assert.equal(verifySignature(body, 'wrong', header), false);
});

test('10. verifySignature rejects when the body has been tampered', () => {
  const body = JSON.stringify({ hello: 'world' });
  const tampered = body.replace('world', 'mars');
  const header = `sha256=${sign(body, 'sek')}`;
  assert.equal(verifySignature(tampered, 'sek', header), false);
});

test('11. verifySignature rejects malformed or missing headers', () => {
  assert.equal(verifySignature('body', 'sek', undefined), false);
  assert.equal(verifySignature('body', 'sek', ''), false);
  assert.equal(verifySignature('body', 'sek', 'sha256=garbage'), false);
  assert.equal(verifySignature('body', 'sek', 'garbage'), false);
  assert.equal(verifySignature('body', 'sek', 'sha1=abc'), false);
});

test('12. verifySignature on empty/edge inputs returns false without throwing', () => {
  assert.doesNotThrow(() => verifySignature('', 'sek', ''));
  assert.equal(verifySignature('', 'sek', ''), false);
  assert.doesNotThrow(() => verifySignature('', '', ''));
  assert.equal(verifySignature('', '', ''), false);
});
