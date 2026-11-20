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
const acceptedEmail = z.object({ id: z.string().min(1) });
export type OAuthProvider = 'GoogleOAuth' | 'AppleOAuth';

export function authProviders(env: AuthEnv, request: typeof fetch = fetch) {
  const origin = new URL(env.APP_ORIGIN);
  const callback = new URL('/auth/callback', origin).href;
  const from = env.MAIL_FROM;
  const resendKey = env.AUTH_RESEND_API_KEY;
  const smtp =
    env.SMTP_HOST && from && !resendKey
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
  const mailEnabled = Boolean(from && (resendKey || smtp));

  async function sendMail(to: string, subject: string, text: string) {
    if (!from) throw new Error('Sign-in email is unavailable');
    if (resendKey) {
      const response = await request('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + resendKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from, to: [to], subject, text }),
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error('The sign-in email provider rejected the request');
      }
      if (!acceptedEmail.safeParse(await response.json()).success)
        throw new Error(
          'The sign-in email provider did not confirm acceptance',
        );
      return;
    }
    if (!smtp) throw new Error('Sign-in email is unavailable');
    await smtp.sendMail({ from, to, subject, text });
  }

  return {
    emailEnabled: Boolean(
      mailEnabled && env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY,
    ),
    buyerEmailEnabled: mailEnabled,
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
      const link = new URL('/sign-in/link', origin);
      link.hash = new URLSearchParams({ token }).toString();
      await sendMail(
        email,
        `Your ${brand.product} sign-in code`,
        `Your sign-in code is ${code}. It expires in 10 minutes.\n\nYou can also sign in using this link:\n${link.href}\n\nIf you did not request this email, you can ignore it.`,
      );
    },

    async sendBuyerCode(email: string, code: string, storefront: string) {
      await sendMail(
        email,
        'Your store sign-in code',
        `Your sign-in code for ${storefront} is ${code}. It expires in 10 minutes. If you did not request the code, you can ignore this email.`,
      );
    },

    async sendAppUserCode(
      email: string,
      code: string,
      application: string,
      signInUrl?: string,
    ) {
      await sendMail(
        email,
        'Your app sign-in code',
        `Your sign-in code for ${application} is ${code}. It expires in 10 minutes.${signInUrl ? ` Sign in at ${signInUrl}.` : ''} If you did not request the code, you can ignore this email.`,
      );
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
