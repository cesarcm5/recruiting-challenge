import { db } from '../db.js';
import { enqueueForOrder } from '../webhooks/enqueue.js';

export interface OrderRow {
  id: string;
  merchant_id: string;
  customer_email: string;
  total_amount: number;
  type: 'sale' | 'refund';
  status: string;
  refunded_order_id: string | null;
  created_at: string;
}

/**
 * Data-access layer for orders. All order queries should go through here.
 *
 * - centralized place for query patterns
 * - the place to add auditing, caching, tenancy filters
 * - the seam for swapping the underlying store
 */
export const ordersDal = {
  listByMerchant(merchantId: string, opts: { from?: string; to?: string; limit?: number } = {}): OrderRow[] {
    const limit = opts.limit ?? 100;
    if (opts.from && opts.to) {
      return db
        .prepare(
          `SELECT * FROM orders
           WHERE merchant_id = ? AND created_at >= ? AND created_at < ?
           ORDER BY created_at DESC
           LIMIT ?`,
        )
        .all(merchantId, opts.from, opts.to, limit) as OrderRow[];
    }
    return db
      .prepare(`SELECT * FROM orders WHERE merchant_id = ? ORDER BY created_at DESC LIMIT ?`)
      .all(merchantId, limit) as OrderRow[];
  },

  getById(id: string, merchantId: string): OrderRow | undefined {
    return db
      .prepare(`SELECT * FROM orders WHERE id = ? AND merchant_id = ?`)
      .get(id, merchantId) as OrderRow | undefined;
  },

  create(
    order: Omit<OrderRow, 'created_at' | 'refunded_order_id'> & { refunded_order_id?: string | null },
  ): OrderRow {
    const run = db.transaction(
      (o: Omit<OrderRow, 'created_at' | 'refunded_order_id'> & { refunded_order_id?: string | null }): OrderRow => {
        db.prepare(
          `INSERT INTO orders (id, merchant_id, customer_email, total_amount, type, status, refunded_order_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(o.id, o.merchant_id, o.customer_email, o.total_amount, o.type, o.status, o.refunded_order_id ?? null);
        const inserted = this.getById(o.id, o.merchant_id)!;
        const eventType = o.type === 'refund' ? 'order.refunded' : 'order.created';
        enqueueForOrder(inserted, eventType);
        return inserted;
      },
    );
    return run(order);
  },

  /**
   * Net revenue over a date range for a merchant: sales minus refunds.
   * Used by the revenue endpoint.
   */
  sumAmountByMerchant(merchantId: string, from: string, to: string): number {
    const row = db
      .prepare(
        `SELECT COALESCE(
           SUM(CASE WHEN type = 'refund' THEN -total_amount ELSE total_amount END),
           0
         ) AS total
         FROM orders
         WHERE merchant_id = ? AND created_at >= ? AND created_at < ?`,
      )
      .get(merchantId, from, to) as { total: number };
    return row.total;
  },
};
