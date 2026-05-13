import { createHmac, timingSafeEqual } from 'node:crypto';

const PREFIX = 'sha256=';

export function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * Verifies the X-T1-Signature header against the raw request body.
 *
 * Returns false on any failure — never throws. The caller passes the raw body
 * exactly as received (string or Buffer); if the body has been parsed by
 * `express.json()`, re-serializing will not produce the same bytes the
 * server signed.
 */
export function verifySignature(
  rawBody: string | Buffer,
  secret: string,
  header: string | undefined,
): boolean {
  if (typeof header !== 'string' || !header.startsWith(PREFIX)) return false;
  const provided = header.slice(PREFIX.length);
  if (!/^[0-9a-f]+$/i.test(provided)) return false;

  const bodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const expected = sign(bodyStr, secret);

  if (provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}
