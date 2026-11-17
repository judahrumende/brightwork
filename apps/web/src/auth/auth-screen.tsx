import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { brand } from '@brightwork/shared';
import { Sky } from '../sky/sky';
import { Button } from '../ui/primitives';
import { api, errorMessage, localReturnTo, write } from './client';
import { loadScript } from './scripts';
import styles from './auth.module.css';

const turnstileUrl =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const googleUrl = 'https://accounts.google.com/gsi/client';
type Options = {
  humanCheck: { siteKey: string };
  providers?: { google: boolean; apple: boolean };
};
type EmailAttempt = { email: string; id: string; link: boolean };
type Mode = 'sign-in' | 'sign-up';

function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className={styles.layout}>
      <aside className={styles.brandSide}>
        <Sky scene="quiet" reduceEffects />
        <a className={styles.wordmark} href="/">
          <img src="/mark.svg" width="26" height="26" alt="" />
          {brand.product}
        </a>
      </aside>
      <div className={styles.formSide}>
        <div className={styles.content}>{children}</div>
      </div>
    </main>
  );
}

export function AuthScreen({ mode }: { mode: Mode }) {
  const [options, setOptions] = useState<Options>();
  const [email, setEmail] = useState('');
  const [attempt, setAttempt] = useState<EmailAttempt>();
  const [token, setToken] = useState('');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(() =>
    new URLSearchParams(location.search).has('error')
      ? 'Social sign-in could not be completed. Try again or use your email.'
      : '',
  );
  const challenge = useRef<HTMLDivElement>(null);
  const widget = useRef<string>(null);
  const returnTo = localReturnTo();
  const registering = mode === 'sign-up';

  useEffect(() => {
    const controller = new AbortController();
    void api<Options>('/api/auth/email/code', { signal: controller.signal })
      .then(setOptions)
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(failure));
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const sitekey = options?.humanCheck.siteKey;
    if (!sitekey || !challenge.current) return;
    let disposed = false;
    const target = challenge.current;
    void loadScript(turnstileUrl)
      .then(() => {
        if (disposed || !window.turnstile) return;
        widget.current = window.turnstile.render(target, {
          sitekey,
          action: 'email-code',
          appearance: 'interaction-only',
          callback: setToken,
          'expired-callback': () => setToken(''),
          'error-callback': () =>
            setError(
              'The security check did not load. Reload the page to try again.',
            ),
        });
      })
      .catch(() => {
        if (!disposed)
          setError(
            'The security check did not load. Reload the page to try again.',
          );
      });
    return () => {
      disposed = true;
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = null;
    };
  }, [options]);

  useEffect(() => {
    const controller = new AbortController();
    let active = false;
    void api<{ clientId: string; nonce?: string }>('/api/auth/google/one-tap', {
      signal: controller.signal,
    })
      .then(async ({ clientId, nonce }) => {
        if (!clientId || !nonce || controller.signal.aborted) return;
        await loadScript(googleUrl);
        if (controller.signal.aborted || !window.google) return;
        active = true;
        window.google.accounts.id.initialize({
          client_id: clientId,
          nonce,
          callback: ({ credential }) => {
            if (controller.signal.aborted) return;
            void write('/api/auth/google/one-tap', { credential })
              .then(() => location.replace(returnTo))
              .catch((failure: unknown) => setError(errorMessage(failure)));
          },
        });
        window.google.accounts.id.prompt();
      })
      .catch(() => {
        /* The regular Google OAuth button is available separately. */
      });
    return () => {
      controller.abort();
      if (active) window.google?.accounts.id.cancel();
    };
  }, [returnTo]);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setError('');
    if (!options?.humanCheck.siteKey) {
      setError('Email sign-in is currently unavailable.');
      return;
    }
    if (!token) {
      setError('Wait for the security check, then try again.');
      return;
    }
    setPending(true);
    const address = email.trim().toLowerCase();
    try {
      const response = await write<{
        sent: boolean;
        attempt: string;
        link: boolean;
      }>('/api/auth/email/code', { email: address, humanCheck: token });
      if (response.sent)
        setAttempt({
          email: address,
          id: response.attempt,
          link: response.link,
        });
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setPending(false);
      setToken('');
      if (widget.current) window.turnstile?.reset(widget.current);
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (!attempt || pending) return;
    setError('');
    setPending(true);
    try {
      await write('/api/auth/email/verify', {
        attempt: attempt.id,
        email: attempt.email,
        code,
      });
      location.replace(returnTo);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setPending(false);
    }
  }

  const social = (name: 'GoogleOAuth' | 'AppleOAuth') => {
    const enabled =
      name === 'GoogleOAuth'
        ? options?.providers?.google
        : options?.providers?.apple;
    if (!enabled) {
      setError(
        `${name === 'GoogleOAuth' ? 'Google' : 'Apple'} sign-in is currently unavailable.`,
      );
      return;
    }
    location.assign(
      '/api/auth/sign-in?' + new URLSearchParams({ provider: name, returnTo }),
    );
  };

  return (
    <AuthLayout>
      {attempt ? (
        <>
          <h1>Check your email</h1>
          <p className={styles.description}>
            We sent a six-digit code to <strong>{attempt.email}</strong>.{' '}
            {attempt.link && 'You can also use the sign-in link in the email.'}
          </p>
          <form
            className={styles.fields}
            onSubmit={(event) => {
              void verify(event);
            }}
          >
            <label htmlFor="login-code">Sign-in code</label>
            <input
              id="login-code"
              type="text"
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              placeholder="000000"
              maxLength={6}
              required
              value={code}
              onChange={(event) =>
                setCode(event.currentTarget.value.replace(/[^0-9]/gu, ''))
              }
            />
            <Button
              type="submit"
              variant="secondary"
              size="large"
              shape="rounded"
              disabled={pending}
            >
              {pending ? 'Checking…' : 'Verify code'}
            </Button>
          </form>
          <p className={styles.switch}>
            <button
              className={styles.linkButton}
              onClick={() => {
                setAttempt(undefined);
                setCode('');
                setError('');
              }}
            >
              Change email or send a new code
            </button>
          </p>
        </>
      ) : (
        <>
          <h1>{registering ? 'Start free' : 'Log in'}</h1>
          <div className={styles.social}>
            <Button
              variant="primary"
              size="large"
              shape="rounded"
              onClick={() => social('GoogleOAuth')}
            >
              Continue with Google
            </Button>
            <Button
              variant="secondary"
              size="large"
              shape="rounded"
              onClick={() => social('AppleOAuth')}
            >
              Continue with Apple
            </Button>
          </div>
          <div className={styles.divider}>or</div>
          <form
            className={styles.fields}
            onSubmit={(event) => {
              void send(event);
            }}
          >
            <label htmlFor="login-email">Email</label>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              placeholder="name@example.com"
              required
              value={email}
              onChange={(event) => setEmail(event.currentTarget.value)}
            />
            <Button
              type="submit"
              variant="secondary"
              size="large"
              shape="rounded"
              disabled={pending}
            >
              {pending ? 'Sending…' : 'Continue'}
            </Button>
          </form>
          <p className={styles.switch}>
            {registering ? 'Already have an account?' : 'New to Brightwork?'}{' '}
            <a
              href={
                (registering ? '/sign-in' : '/sign-up') +
                '?returnTo=' +
                encodeURIComponent(returnTo)
              }
            >
              {registering ? 'Log in' : 'Sign up'}
            </a>
          </p>
          <p className={styles.legal}>
            By continuing, you accept the {brand.product}{' '}
            <a href="/terms">Terms of Service</a> and acknowledge our{' '}
            <a href="/privacy">Privacy Policy</a> and{' '}
            <a href="/refund-policy">Refund Policy</a>.
          </p>
        </>
      )}
      <div
        ref={challenge}
        className={styles.challenge}
        hidden={Boolean(attempt)}
      />
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </AuthLayout>
  );
}

export function MagicLinkScreen() {
  const [token] = useState(() =>
    new URLSearchParams(location.hash.slice(1)).get('token'),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (token) history.replaceState(null, '', location.pathname);
  }, [token]);

  async function continueWithLink() {
    if (!token) return;
    setPending(true);
    try {
      await write('/api/auth/email/link', { token });
      location.replace('/home');
    } catch (failure) {
      setError(errorMessage(failure));
      setPending(false);
    }
  }
  return (
    <AuthLayout>
      <h1>Finish signing in</h1>
      <p className={styles.description}>
        {token
          ? `Continue to your ${brand.product} account.`
          : 'This sign-in link is missing its verification token.'}
      </p>
      {token && (
        <Button
          disabled={pending}
          onClick={() => {
            void continueWithLink();
          }}
        >
          {pending ? 'Signing in…' : 'Continue'}
        </Button>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <p className={styles.switch}>
        <a href="/sign-in">Back to log in</a>
      </p>
    </AuthLayout>
  );
}
