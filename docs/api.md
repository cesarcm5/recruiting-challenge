# API reference

## Authentication

The dashboard API uses **JWT bearer tokens** (HS256, 1-hour expiry).

1. Obtain a token from `POST /api/auth/login` (see below).
2. Send the token on every subsequent request as:
   ```
   Authorization: Bearer <token>
   ```

A missing, malformed, expired, or invalid token returns `401`. The token's `sub`
claim is the authenticated `merchant_id`; the server reads tenancy exclusively
from the token (the old `X-Merchant-Id` header is no longer accepted).

### Configuration

- `JWT_SECRET` — required in production. Must be at least 16 characters. If not
  set, the server generates an ephemeral random secret at startup and logs a
  warning; tokens issued by one process will be rejected by another.

### Seed credentials (dev)

- `m_acme` / `acme-dev-password`
- `m_bistro` / `bistro-dev-password`

These are set by the seeder on first run; in production the seeder must be
replaced with real provisioning.

## `POST /api/auth/login`
No auth. Body: `{ merchant_id, password }`.
- `200` → `{ token, token_type: "Bearer", expires_in, merchant: { id, name } }`
- `400` → `{ error: "invalid_body" }` when fields are missing/wrong type.
- `401` → `{ error: "invalid_credentials" }` for unknown merchant **and** wrong
  password (intentionally indistinguishable).

## `GET /api/health`
No auth. Returns `{ ok: true }`.

## `GET /api/orders`
List orders for the authenticated merchant. Optional query: `from`, `to`, `limit`.

## `GET /api/orders/:id`
Get a single order by ID. **Tenant-scoped**: returns `404 not_found` both when the
order does not exist *and* when it belongs to another merchant. The two cases are
intentionally indistinguishable so the endpoint cannot be used as an existence
oracle across tenants.

## `POST /api/orders`
Body: `{ customer_email, total_amount, type? }`.

## `GET /api/revenue?from=...&to=...`
Total revenue for the merchant in the date range.

## `GET /api/metrics/summary`
TODO: document fields.

## `GET /api/metrics/top-customers`
TODO: document fields.

## Webhooks

Merchants can subscribe an HTTPS URL to receive POST notifications when orders
are created or refunded. Delivery is **at-least-once**: a 2xx response from the
subscriber acknowledges; anything else (non-2xx, timeout, network error) is
retried up to 4 times after the initial attempt with backoff `30s, 2m, 10m, 1h`.
After the 5th failed attempt the delivery is marked `failed` and not retried.

The dispatcher runs in-process inside the dashboard server (`setInterval` every
5s); in a multi-instance deployment this would need to move to a broker or to
`SELECT ... FOR UPDATE SKIP LOCKED` semantics — out of scope for the MVP.

### Event payload

Each delivery is a single JSON event:

```json
{
  "id": "evt_<uuid>",
  "type": "order.created",
  "created_at": "2026-05-12T10:00:00.000Z",
  "api_version": "2026-05-12",
  "data": {
    "id": "<order-id>",
    "merchant_id": "m_acme",
    "customer_email": "...",
    "total_amount": 1234,
    "type": "sale",
    "status": "completed",
    "refunded_order_id": null,
    "created_at": "2026-05-12 10:00:00"
  }
}
```

The `id` is stable across retries — use it to deduplicate on the subscriber
side. `type` is one of `order.created` or `order.refunded`. For refunds,
`data.refunded_order_id` points at the original sale (when the creator of the
refund supplied it on `POST /api/orders`).

### Signature

Every delivery is signed with HMAC-SHA256 of the **raw response body** using the
subscription secret. The signature is sent as:

```
X-T1-Signature: sha256=<hex digest>
```

Subscribers MUST verify the signature against the raw request body (not the
parsed JSON — re-serialization may not match byte-for-byte). The verifier
shipped at `src/webhooks/verify.ts` is the canonical implementation:

```ts
import express from 'express';
import { verifySignature } from '<this-repo>/src/webhooks/verify.js';

const app = express();
app.post(
  '/hook',
  express.raw({ type: 'application/json' }),
  (req, res) => {
    const ok = verifySignature(req.body, MY_SECRET, req.header('x-t1-signature'));
    if (!ok) return res.status(401).end();
    const event = JSON.parse(req.body.toString('utf8'));
    // ... handle event.type, dedupe on event.id
    res.status(204).end();
  },
);
```

The signature scheme does **not** include a timestamp. Replay protection is the
subscriber's responsibility for now (dedupe on `event.id`); adding a timestamped
scheme is a deliberate future step.

## `POST /api/webhook-subscriptions`

Body: `{ url: string, event_types: ('order.created' | 'order.refunded')[] }`.

- `url` must be `https://`. `http://localhost` and `http://127.0.0.1` are
  accepted **only** when `NODE_ENV !== 'production'`.
- `event_types` must be a non-empty subset of the supported types.

Returns `201` with `{ subscription, secret }`. **The `secret` is returned only
in this response.** Store it immediately; to rotate, delete and recreate.

## `GET /api/webhook-subscriptions`

Returns `200 { subscriptions: [...] }` — does not include the secret.

## `DELETE /api/webhook-subscriptions/:id`

`204` on success. `404 not_found` for an unknown id and for an id belonging to
another merchant (same indistinguishable pattern as `GET /api/orders/:id`).

## `GET /api/webhook-subscriptions/:id/deliveries?limit=50`

Returns `200 { deliveries: [...] }` with one row per delivery attempt set:

```json
{
  "id": "evt_...",
  "event_type": "order.created",
  "status": "pending | delivered | failed",
  "attempts": 0,
  "next_attempt_at": "...",
  "last_error": null,
  "response_status": null,
  "created_at": "...",
  "delivered_at": null
}
```

`limit` defaults to 50, capped at 200. Tenant-scoped: `404` if the subscription
belongs to another merchant.
