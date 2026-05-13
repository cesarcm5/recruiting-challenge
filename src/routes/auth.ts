import { Router } from 'express';
import { merchantsDal } from '../dal/merchants-dal.js';
import { verifyPassword } from '../passwords.js';
import { signAccessToken } from '../auth.js';

export const authRouter = Router();

authRouter.post('/login', (req, res) => {
  const body = req.body as { merchant_id?: unknown; password?: unknown };
  const merchantId = typeof body.merchant_id === 'string' ? body.merchant_id : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!merchantId || !password) {
    res.status(400).json({ error: 'invalid_body' });
    return;
  }

  const merchant = merchantsDal.getById(merchantId);
  if (!merchant || !merchant.password_hash || !verifyPassword(password, merchant.password_hash)) {
    res.status(401).json({ error: 'invalid_credentials' });
    return;
  }

  const { token, expires_in } = signAccessToken(merchant.id);
  res.json({ token, token_type: 'Bearer', expires_in, merchant: { id: merchant.id, name: merchant.name } });
});
