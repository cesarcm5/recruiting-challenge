import { randomUUID } from 'node:crypto';
import { subscriptionsDal } from './subscriptions-dal.js';
import { deliveriesDal } from './deliveries-dal.js';
import { API_VERSION, type EventEnvelope, type EventType } from './types.js';
import type { OrderRow } from '../dal/orders-dal.js';

/**
 * Called inside the order-create transaction. Looks up matching subscriptions
 * for the merchant and inserts a pending delivery row for each one.
 *
 * Must be invoked from within a `db.transaction(() => ...)` so the order INSERT
 * and the delivery INSERTs commit together (transactional outbox).
 */
export function enqueueForOrder(order: OrderRow, eventType: EventType): void {
  const subscriptions = subscriptionsDal.listEnabledMatching(order.merchant_id, eventType);
  if (subscriptions.length === 0) return;

  const now = new Date().toISOString();

  for (const sub of subscriptions) {
    const envelope: EventEnvelope = {
      id: `evt_${randomUUID()}`,
      type: eventType,
      created_at: now,
      api_version: API_VERSION,
      data: order as unknown as Record<string, unknown>,
    };
    deliveriesDal.create({
      id: envelope.id,
      subscription_id: sub.id,
      merchant_id: order.merchant_id,
      event_type: eventType,
      payload_json: JSON.stringify(envelope),
      next_attempt_at: now,
    });
  }
}
