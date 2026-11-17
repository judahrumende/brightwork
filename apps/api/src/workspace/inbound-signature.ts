import { createHmac, timingSafeEqual } from 'node:crypto';

const signingWindowSeconds = 300;
export const inboundSecret = /^whsec_[A-Za-z0-9+/]+={0,2}$/u;

export function verifyInboundSignature(
  secret: string,
  body: Buffer,
  headers: Record<string, string | string[] | undefined>,
  now = Date.now(),
) {
  const id = headers['svix-id'];
  const timestamp = headers['svix-timestamp'];
  const signatures = headers['svix-signature'];
  if (
    typeof id !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/u.test(id) ||
    typeof timestamp !== 'string' ||
    !/^\d{1,12}$/u.test(timestamp) ||
    Math.abs(now / 1000 - Number(timestamp)) > signingWindowSeconds ||
    typeof signatures !== 'string' ||
    signatures.length > 4096 ||
    !inboundSecret.test(secret)
  ) {
    return false;
  }

  const key = Buffer.from(secret.slice('whsec_'.length), 'base64');
  if (key.length < 16) return false;
  const expected = createHmac('sha256', key)
    .update(id + '.' + timestamp + '.')
    .update(body)
    .digest();
  return signatures.split(/\s+/u).some((signature) => {
    if (!/^v1,[A-Za-z0-9+/]{43}=$/u.test(signature)) return false;
    return timingSafeEqual(expected, Buffer.from(signature.slice(3), 'base64'));
  });
}
