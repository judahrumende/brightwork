import { createRemoteJWKSet, jwtVerify } from 'jose';
import nodemailer from 'nodemailer';
import { z } from 'zod';
import type { AuthEnv } from './config';
import type { SocialIdentity } from './store';
import { pkceChallenge, sameToken } from './tokens';
import { brand } from '@brightwork/shared';

const workosUrl = 'https://api.workos.com/user_management/';
const googleKeys = createRemoteJWKSet(
  new URL('https://www.googleapis.com/oauth2/v3/certs'),
);
const socialUser = z.object({
  user: z.object({
    id: z.string().min(1),
    email: z.email(),
    email_verified: z.literal(true),
    first_name: z.string().nullish(),
    last_name: z.string().nullish(),
  }),
});
export type OAuthProvider = 'GoogleOAuth' | 'AppleOAuth';

export function authProviders(env: AuthEnv, request: typeof fetch = fetch) {
  const origin = new URL(env.APP_ORIGIN);
  const callback = new URL('/auth/callback', origin).href;
  const mail =
    env.SMTP_HOST && env.MAIL_FROM
      ? nodemailer.createTransport({
          host: env.SMTP_HOST,
          port: env.SMTP_PORT,
          secure: env.SMTP_SECURE === 'true',
          ...(env.SMTP_USER && env.SMTP_PASSWORD
            ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } }
            : {}),
          connectionTimeout: 5_000,
          socketTimeout: 10_000,
        })
      : null;

  return {
    emailEnabled: Boolean(
      mail && env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY,
    ),
    buyerEmailEnabled: Boolean(mail),
    oauthEnabled: Boolean(env.WORKOS_CLIENT_ID && env.WORKOS_API_KEY),

    async verifyHuman(token: string, ip: string) {
      if (!env.TURNSTILE_SECRET_KEY) return false;
      const res = await request(
        'https://challenges.cloudflare.com/turnstile/v0/siteverify',
        {
          method: 'POST',
          body: new URLSearchParams({
            secret: env.TURNSTILE_SECRET_KEY,
            response: token,
            remoteip: ip,
          }),
          signal: AbortSignal.timeout(8_000),
          redirect: 'error',
        },
      );
      const payload = z
        .object({
          success: z.boolean(),
          hostname: z.string().optional(),
          action: z.string().optional(),
        })
        .safeParse(res.ok ? await res.json() : null);
      if (!payload.success || !payload.data.success) return false;
      // Cloudflare's published test secret returns placeholder metadata.
      const localTest =
        ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) &&
        env.TURNSTILE_SECRET_KEY === '1x0000000000000000000000000000000AA';
      return (
        localTest ||
        (payload.data.hostname === origin.hostname &&
          payload.data.action === 'email-code')
      );
    },

    async sendCode(email: string, code: string, token: string) {
      if (!mail || !env.MAIL_FROM) throw new Error('SMTP is unavailable');
      const link = new URL('/sign-in/link', origin);
      link.hash = new URLSearchParams({ token }).toString();
      await mail.sendMail({
        from: env.MAIL_FROM,
        to: email,
        subject: `Your ${brand.product} sign-in code`,
        text: `Your sign-in code is ${code}. It expires in 10 minutes.\n\nYou can also sign in using this link:\n${link.href}\n\nIf you did not request this email, you can ignore it.`,
      });
    },

    async sendBuyerCode(email: string, code: string, storefront: string) {
      if (!mail || !env.MAIL_FROM) throw new Error('SMTP is unavailable');
      await mail.sendMail({
        from: env.MAIL_FROM,
        to: email,
        subject: 'Your store sign-in code',
        text: `Your sign-in code for ${storefront} is ${code}. It expires in 10 minutes. If you did not request the code, you can ignore this email.`,
      });
    },

    authorizationUrl(provider: OAuthProvider, state: string, verifier: string) {
      if (!env.WORKOS_CLIENT_ID) throw new Error('WorkOS is unavailable');
      const url = new URL('authorize', workosUrl);
      url.search = new URLSearchParams({
        client_id: env.WORKOS_CLIENT_ID,
        provider,
        state,
        response_type: 'code',
        redirect_uri: callback,
        code_challenge: pkceChallenge(verifier),
        code_challenge_method: 'S256',
      }).toString();
      return url.href;
    },

    async exchangeCode(
      code: string,
      verifier: string,
    ): Promise<SocialIdentity> {
      const res = await request(new URL('authenticate', workosUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: env.WORKOS_CLIENT_ID,
          client_secret: env.WORKOS_API_KEY,
          grant_type: 'authorization_code',
          code,
          code_verifier: verifier,
        }),
        signal: AbortSignal.timeout(8_000),
        redirect: 'error',
      });
      if (!res.ok)
        throw new Error('WorkOS could not exchange the authorization code');
      const { user } = socialUser.parse(await res.json());
      return {
        provider: 'workos',
        subject: user.id,
        email: user.email.toLowerCase(),
        name:
          [user.first_name, user.last_name].filter(Boolean).join(' ') || null,
      };
    },

    async verifyGoogle(
      credential: string,
      nonce: string,
    ): Promise<SocialIdentity> {
      if (!env.GOOGLE_CLIENT_ID)
        throw new Error('Google One Tap is unavailable');
      const { payload } = await jwtVerify(credential, googleKeys, {
        issuer: ['accounts.google.com', 'https://accounts.google.com'],
        audience: env.GOOGLE_CLIENT_ID,
        algorithms: ['RS256'],
        requiredClaims: ['exp', 'sub', 'nonce'],
      });
      const claims = z
        .object({
          sub: z.string().min(1),
          nonce: z.string(),
          email: z.email(),
          email_verified: z.literal(true),
          name: z.string().optional(),
          hd: z.string().optional(),
        })
        .parse(payload);
      const email = claims.email.toLowerCase();
      if (
        !sameToken(claims.nonce, nonce) ||
        !(email.endsWith('@gmail.com') || claims.hd)
      ) {
        throw new Error('Google email ownership could not be verified');
      }
      return {
        provider: 'google',
        subject: claims.sub,
        email,
        name: claims.name ?? null,
      };
    },
  };
}
