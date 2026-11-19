import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyStripeSignature(
  secret: string,
  raw: Buffer,
  header: string | string[] | undefined,
) {
  if (typeof header !== 'string' || header.length > 4096) return false;
  const fields = header.split(',');
  const clocks = fields.filter((field) => field.startsWith('t='));
  if (clocks.length !== 1 || !/^t=\d{10}$/u.test(clocks[0] ?? '')) return false;
  const timestamp = clocks[0]!.slice(2);
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const hmac = createHmac('sha256', secret)
    .update(timestamp + '.')
    .update(raw)
    .digest();
  return fields.some(
    (field) =>
      /^v1=[a-f0-9]{64}$/u.test(field) &&
      timingSafeEqual(hmac, Buffer.from(field.slice(3), 'hex')),
  );
}

export type StripeMode = 'test' | 'live';

export function stripeClient(
  key: string,
  transport: typeof fetch = fetch,
  mode: StripeMode = 'test',
) {
  if (!new RegExp('^(sk|rk)_' + mode + '_', 'u').test(key))
    throw new Error('Use a Stripe ' + mode + '-mode key.');
  return async function stripe(
    path: string,
    body?: Record<string, string>,
    idempotencyKey?: string,
    connectedAccount?: string,
  ) {
    const result = await transport('https://api.stripe.com/v1/' + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: 'Bearer ' + key,
        'Stripe-Version': '2024-10-28.acacia',
        ...(body
          ? { 'Content-Type': 'application/x-www-form-urlencoded' }
          : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        ...(connectedAccount ? { 'Stripe-Account': connectedAccount } : {}),
      },
      ...(body ? { body: new URLSearchParams(body) } : {}),
      redirect: 'error',
      signal: AbortSignal.timeout(8_000),
    });
    if (!result.ok) {
      await result.body?.cancel();
      throw new Error('Stripe could not complete this request.');
    }
    return result.json() as Promise<unknown>;
  };
}
