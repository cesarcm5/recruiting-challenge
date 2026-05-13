import type { Request, Response, NextFunction } from 'express';
import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';

declare global {
  namespace Express {
    interface Request {
      merchantId?: string;
    }
  }
}

const TOKEN_TTL_SECONDS = 60 * 60;
const ISSUER = 't1-dashboard';

function loadSecret(): string {
  const fromEnv = process.env.JWT_SECRET;
  if (fromEnv && fromEnv.length >= 16) return fromEnv;
  if (fromEnv) {
    throw new Error('JWT_SECRET must be at least 16 characters');
  }
  const generated = randomBytes(32).toString('hex');
  console.warn(
    '[auth] JWT_SECRET not set; generated an ephemeral secret. Tokens will not survive a restart. Set JWT_SECRET in production.',
  );
  return generated;
}

const SECRET = loadSecret();

export function signAccessToken(merchantId: string): { token: string; expires_in: number } {
  const options: SignOptions = {
    algorithm: 'HS256',
    expiresIn: TOKEN_TTL_SECONDS,
    issuer: ISSUER,
    subject: merchantId,
  };
  const token = jwt.sign({}, SECRET, options);
  return { token, expires_in: TOKEN_TTL_SECONDS };
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const header = req.header('authorization') ?? req.header('Authorization');
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'missing_token' });
    return;
  }
  const token = header.slice('Bearer '.length).trim();
  if (!token) {
    res.status(401).json({ error: 'missing_token' });
    return;
  }
  try {
    const payload = jwt.verify(token, SECRET, {
      algorithms: ['HS256'],
      issuer: ISSUER,
    }) as JwtPayload;
    if (typeof payload.sub !== 'string' || !payload.sub) {
      res.status(401).json({ error: 'invalid_token' });
      return;
    }
    req.merchantId = payload.sub;
    next();
  } catch {
    res.status(401).json({ error: 'invalid_token' });
  }
}
