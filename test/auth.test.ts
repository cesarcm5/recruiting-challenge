// Set DB_PATH and a stable JWT_SECRET before importing the app modules.
if (!process.env.DB_PATH) process.env.DB_PATH = ':memory:';
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'test-secret-test-secret-test-secret';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'node:http';
import { initSchema, db } from '../src/db.js';
import { hashPassword } from '../src/passwords.js';
import { authMiddleware } from '../src/auth.js';
import { authRouter } from '../src/routes/auth.js';

let server: Server;
let baseUrl: string;

before(async () => {
  initSchema();
  db.prepare(`INSERT OR IGNORE INTO merchants (id, name) VALUES ('m_auth', 'Auth Test')`).run();
  db.prepare(`UPDATE merchants SET password_hash = ? WHERE id = 'm_auth'`).run(hashPassword('secret123'));

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  app.get('/protected', authMiddleware, (req, res) => {
    res.json({ merchant_id: req.merchantId });
  });

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no server address');
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('POST /api/auth/login with valid credentials returns a JWT', async () => {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ merchant_id: 'm_auth', password: 'secret123' }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { token: string; token_type: string; expires_in: number };
  assert.equal(body.token_type, 'Bearer');
  assert.ok(typeof body.token === 'string' && body.token.split('.').length === 3);
  assert.ok(body.expires_in > 0);
});

test('POST /api/auth/login with wrong password returns 401', async () => {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ merchant_id: 'm_auth', password: 'wrong' }),
  });
  assert.equal(res.status, 401);
});

test('POST /api/auth/login with unknown merchant returns 401 (same as wrong password)', async () => {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ merchant_id: 'm_nope', password: 'whatever' }),
  });
  assert.equal(res.status, 401);
});

test('protected endpoint without Authorization header returns 401', async () => {
  const res = await fetch(`${baseUrl}/protected`);
  assert.equal(res.status, 401);
});

test('protected endpoint with invalid token returns 401', async () => {
  const res = await fetch(`${baseUrl}/protected`, {
    headers: { Authorization: 'Bearer not-a-real-jwt' },
  });
  assert.equal(res.status, 401);
});

test('protected endpoint with valid token returns merchant_id from sub claim', async () => {
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ merchant_id: 'm_auth', password: 'secret123' }),
  });
  const { token } = (await loginRes.json()) as { token: string };

  const res = await fetch(`${baseUrl}/protected`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { merchant_id: string };
  assert.equal(body.merchant_id, 'm_auth');
});

test('X-Merchant-Id header is no longer accepted', async () => {
  const res = await fetch(`${baseUrl}/protected`, {
    headers: { 'X-Merchant-Id': 'm_auth' },
  });
  assert.equal(res.status, 401);
});
