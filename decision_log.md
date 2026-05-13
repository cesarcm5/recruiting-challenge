# Decision Log — César Contreras

## Issues addressed

- **IDOR on `GET /api/orders/:id`** · query missing merchant scope · filter pushed into `ordersDal.getById(id, merchantId)` · 404 indistinguishable across tenants · rejected 403 (leaks existence).
- **Trusted-header auth** · `X-Merchant-Id` accepted without verification · replaced with `/api/auth/login` (scrypt + 1h HS256 JWT, `sub` = merchant_id) and `Authorization: Bearer` · added `password_hash`, dev seeds, `/login.html` · rejected users-per-merchant (budget).
- **Refunds inflated revenue** · `sumAmountByMerchant` summed all rows regardless of `type` · switched to `SUM(CASE WHEN type='refund' THEN -total_amount ELSE total_amount END)` · regression tests pin sign math + half-open `[from, to)` · rejected gross/refund/net split (breaking change).

## Feature chosen — order-event webhooks (`order.created`, `order.refunded`)

- **Shape:** transactional outbox · HMAC-SHA256 body signature · in-process dispatcher · backoff `30s, 2m, 10m, 1h` × 5 attempts · shipped verifier.
- **Why this:** crosses more boundaries than CSV/search — external receiver, auth-to-merchant, downtime recovery.
- **Cuts:** `order.status_changed` (needs a state machine) · no UI · no replay protection · single-process dispatcher.

## Things I noticed but did NOT fix

- `routes/metrics.ts` bypasses `ordersDal` (architecture doc flags it).
- `setInterval` dispatcher races itself multi-instance.
- No `.nvmrc` for Node version pinning.

## Docs / code I left alone deliberately

- `seed.ts` bypasses `ordersDal.create` on purpose · seeding 80 historical orders shouldn't fire 80 webhooks.
- Static dashboard · feature is API-only by design.

## What I'd do with another 6 hours

- `order.status_changed` + `PATCH /api/orders/:id` + state machine.
- Timestamped signature `t=,v1=` + dual-secret rotation window.
- `locked_by`/`locked_until` lease on `webhook_deliveries` for multi-instance dispatch.
