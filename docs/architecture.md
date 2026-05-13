# Architecture

## Modules

- **`server.ts`** — Express bootstrapper. Wires routers to paths and starts the
  webhook dispatcher.
- **`db.ts`** — SQLite connection + schema init. Single shared `db` instance.
- **`auth.ts`** — JWT bearer authentication. Validates `Authorization: Bearer`
  on every protected route and sets `req.merchantId` from the token's `sub`.
- **`dal/`** — data-access layer. All order queries route through `ordersDal`;
  it owns the transaction that couples order writes to the webhook outbox.
- **`routes/`** — Express routers, one file per resource.
- **`webhooks/`** — event emission, dispatch, and signature verification (see
  below).

## Data model

Four tables: `merchants`, `orders`, `webhook_subscriptions`, `webhook_deliveries`.
See `db.ts` for the canonical DDL.

`orders.type` is one of `'sale' | 'refund'`. A refund row records that a sale
was reversed; `orders.refunded_order_id` is a nullable self-FK that links a
refund row to its original sale so webhook subscribers can correlate.
`sumAmountByMerchant` in `ordersDal` computes net revenue from these signs.

## Webhooks module

`src/webhooks/` implements an outbox-style delivery pipeline:

- **`subscriptions-dal.ts`** — CRUD for `webhook_subscriptions`, including
  `listEnabledMatching(merchantId, eventType)` used by the outbox to fan out.
- **`deliveries-dal.ts`** — CRUD for `webhook_deliveries` (the outbox table).
- **`enqueue.ts`** — `enqueueForOrder(orderRow, eventType)` is invoked **inside
  the same `db.transaction(...)` as the order INSERT** (see `ordersDal.create`).
  This guarantees that an order row exists iff its outbox rows exist; there is
  no fire-and-forget `fetch` from the request path.
- **`dispatcher.ts`** — `tick()` runs one pass over due pending deliveries.
  `start()` schedules `tick()` on a 5-second `setInterval` and `unref()`s it.
  Tests call `tick()` directly and never start the interval.
- **`verify.ts`** — `sign(body, secret)` and `verifySignature(rawBody, secret,
  header)`. The verifier is the same helper subscribers consume, so the docs
  example IS the tested code.

### Seams worth naming

- **Single-DB outbox.** Because the outbox lives in the same SQLite database as
  the orders table, the order INSERT and the delivery INSERTs commit together
  natively. In a real deployment with a separate broker (Kafka, SQS, etc.) this
  becomes a transactional-outbox + CDC problem.
- **Single-process dispatcher.** The in-process `setInterval` works because the
  dev server is single-instance. Multi-instance deployments need either
  `SKIP LOCKED` semantics or a real broker — the table layout supports either.
- **Body-only signature.** The signature does not bind a timestamp, so replay
  protection is the subscriber's job (dedupe on `event.id`). A future
  timestamped scheme would just add a column to the signed payload.
