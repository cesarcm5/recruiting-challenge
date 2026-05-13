import { Router } from 'express';
import { ordersDal } from '../dal/orders-dal.js';
import { randomUUID } from 'node:crypto';

export const ordersRouter = Router();

ordersRouter.get('/', (req, res) => {
  const orders = ordersDal.listByMerchant(req.merchantId!, {
    from: typeof req.query.from === 'string' ? req.query.from : undefined,
    to: typeof req.query.to === 'string' ? req.query.to : undefined,
    limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined,
  });
  res.json({ orders });
});

ordersRouter.get('/:id', (req, res) => {
  const order = ordersDal.getById(req.params.id, req.merchantId!);
  if (!order) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.json({ order });
});

ordersRouter.post('/', (req, res) => {
  const body = req.body as {
    customer_email?: string;
    total_amount?: number;
    type?: 'sale' | 'refund';
    refunded_order_id?: string;
  };
  if (!body.customer_email || typeof body.total_amount !== 'number') {
    res.status(400).json({ error: 'invalid_body' });
    return;
  }
  const type = body.type ?? 'sale';
  if (body.refunded_order_id !== undefined && type !== 'refund') {
    res.status(400).json({ error: 'refunded_order_id_requires_refund_type' });
    return;
  }
  if (type === 'refund' && body.refunded_order_id) {
    const original = ordersDal.getById(body.refunded_order_id, req.merchantId!);
    if (!original) {
      res.status(400).json({ error: 'refunded_order_not_found' });
      return;
    }
  }
  const order = ordersDal.create({
    id: randomUUID(),
    merchant_id: req.merchantId!,
    customer_email: body.customer_email,
    total_amount: body.total_amount,
    type,
    status: 'completed',
    refunded_order_id: body.refunded_order_id ?? null,
  });
  res.status(201).json({ order });
});
