import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';

export const sessionLifetimeSeconds = 30 * 24 * 60 * 60;
export const challengeLifetimeSeconds = 10 * 60;
export const challengeAttempts = 5;

export const randomToken = () => randomBytes(32).toString('base64url');
export const randomCode = () =>
  randomInt(0, 1_000_000).toString().padStart(6, '0');
export const digest = (secret: string, kind: string, value: string) =>
  createHmac('sha256', secret)
    .update(kind)
    .update('\0')
    .update(value)
    .digest('base64url');
export const pkceChallenge = (verifier: string) =>
  createHash('sha256').update(verifier).digest('base64url');

export function sameToken(first: string, second: string) {
  const a = Buffer.from(first);
  const b = Buffer.from(second);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function safeReturnTo(value: string | undefined, origin: string) {
  if (
    !value?.startsWith('/') ||
    value.startsWith('//') ||
    [...value].some(
      (char) =>
        char === '\\' || char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127,
    )
  )
    return '/home';
  const url = new URL(value, origin);
  return url.origin === origin && !url.pathname.startsWith('//')
    ? url.pathname + url.search + url.hash
    : '/home';
}

export function browserCookie(header: string | undefined, name: string) {
  const prefix = name + '=';
  const matches = header
    ?.split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(prefix));
  if (matches?.length !== 1) return undefined;
  return matches[0]?.slice(prefix.length);
}

export function cookie(
  name: string,
  value: string,
  secure: boolean,
  maxAge: number,
) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
