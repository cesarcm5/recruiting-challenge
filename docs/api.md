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
Get a single order by ID.

## `POST /api/orders`
Body: `{ customer_email, total_amount, type? }`.

## `GET /api/revenue?from=...&to=...`
Total revenue for the merchant in the date range.

## `GET /api/metrics/summary`
TODO: document fields.

## `GET /api/metrics/top-customers`
TODO: document fields.
