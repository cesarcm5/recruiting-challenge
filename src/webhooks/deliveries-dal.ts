import { db } from '../db.js';
import type { WebhookDeliveryRow } from './types.js';

export const deliveriesDal = {
  create(row: {
    id: string;
    subscription_id: string;
    merchant_id: string;
    event_type: string;
    payload_json: string;
    next_attempt_at: string;
  }): void {
    db.prepare(
      `INSERT INTO webhook_deliveries
         (id, subscription_id, merchant_id, event_type, payload_json, status, attempts, next_attempt_at)
       VALUES (?, ?, ?, ?, ?, 'pending', 0, ?)`,
    ).run(
      row.id,
      row.subscription_id,
      row.merchant_id,
      row.event_type,
      row.payload_json,
      row.next_attempt_at,
    );
  },

  listBySubscription(subscriptionId: string, limit: number): WebhookDeliveryRow[] {
    return db
      .prepare(
        `SELECT * FROM webhook_deliveries
         WHERE subscription_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(subscriptionId, limit) as WebhookDeliveryRow[];
  },

  listDuePending(now: string, limit: number): WebhookDeliveryRow[] {
    return db
      .prepare(
        `SELECT * FROM webhook_deliveries
         WHERE status = 'pending' AND next_attempt_at <= ?
         ORDER BY next_attempt_at ASC
         LIMIT ?`,
      )
      .all(now, limit) as WebhookDeliveryRow[];
  },

  markDelivered(id: string, responseStatus: number, deliveredAt: string): void {
    db.prepare(
      `UPDATE webhook_deliveries
       SET status = 'delivered', response_status = ?, delivered_at = ?, attempts = attempts + 1, last_error = NULL
       WHERE id = ?`,
    ).run(responseStatus, deliveredAt, id);
  },

  recordFailure(
    id: string,
    lastError: string,
    responseStatus: number | null,
    nextAttemptAt: string | null,
  ): void {
    if (nextAttemptAt === null) {
      db.prepare(
        `UPDATE webhook_deliveries
         SET status = 'failed', attempts = attempts + 1, last_error = ?, response_status = ?
         WHERE id = ?`,
      ).run(lastError, responseStatus, id);
    } else {
      db.prepare(
        `UPDATE webhook_deliveries
         SET attempts = attempts + 1, last_error = ?, response_status = ?, next_attempt_at = ?
         WHERE id = ?`,
      ).run(lastError, responseStatus, nextAttemptAt, id);
    }
  },
};
