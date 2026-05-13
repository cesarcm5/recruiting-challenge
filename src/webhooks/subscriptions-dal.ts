import { db } from '../db.js';
import {
  type EventType,
  type WebhookSubscription,
  type WebhookSubscriptionRow,
  rowToSubscription,
} from './types.js';

export const subscriptionsDal = {
  create(input: {
    id: string;
    merchant_id: string;
    url: string;
    secret: string;
    event_types: EventType[];
  }): WebhookSubscription {
    db.prepare(
      `INSERT INTO webhook_subscriptions (id, merchant_id, url, secret, event_types, enabled)
       VALUES (?, ?, ?, ?, ?, 1)`,
    ).run(input.id, input.merchant_id, input.url, input.secret, JSON.stringify(input.event_types));
    return rowToSubscription(this.getRow(input.id, input.merchant_id)!);
  },

  getRow(id: string, merchantId: string): WebhookSubscriptionRow | undefined {
    return db
      .prepare(`SELECT * FROM webhook_subscriptions WHERE id = ? AND merchant_id = ?`)
      .get(id, merchantId) as WebhookSubscriptionRow | undefined;
  },

  getById(id: string, merchantId: string): WebhookSubscription | undefined {
    const row = this.getRow(id, merchantId);
    return row ? rowToSubscription(row) : undefined;
  },

  listByMerchant(merchantId: string): WebhookSubscription[] {
    const rows = db
      .prepare(`SELECT * FROM webhook_subscriptions WHERE merchant_id = ? ORDER BY created_at DESC`)
      .all(merchantId) as WebhookSubscriptionRow[];
    return rows.map(rowToSubscription);
  },

  deleteById(id: string, merchantId: string): boolean {
    const info = db
      .prepare(`DELETE FROM webhook_subscriptions WHERE id = ? AND merchant_id = ?`)
      .run(id, merchantId);
    return info.changes > 0;
  },

  /**
   * Used inside the order-create transaction to fan out to matching subscriptions.
   * Returns raw rows so the secret is available for downstream signing if needed.
   */
  listEnabledMatching(merchantId: string, eventType: EventType): WebhookSubscriptionRow[] {
    const rows = db
      .prepare(
        `SELECT * FROM webhook_subscriptions
         WHERE merchant_id = ? AND enabled = 1
         AND EXISTS (
           SELECT 1 FROM json_each(webhook_subscriptions.event_types)
           WHERE json_each.value = ?
         )`,
      )
      .all(merchantId, eventType) as WebhookSubscriptionRow[];
    return rows;
  },
};
