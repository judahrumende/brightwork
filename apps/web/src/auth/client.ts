export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

let volatileTabId: string | undefined;
function sessionId() {
  volatileTabId ??= crypto.randomUUID();
  try {
    const stored = sessionStorage.getItem('brightwork-tab');
    if (stored) return stored;
    sessionStorage.setItem('brightwork-tab', volatileTabId);
  } catch {
    /* A confined browser may deny sessionStorage. */
  }
  return volatileTabId;
}

export async function api<Result>(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('X-Session-Id', sessionId());
  headers.set('Accept', 'application/json');
  if (init.body != null) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'message' in data
        ? data.message
        : null;
    throw new ApiError(
      response.status,
      typeof message === 'string'
        ? message
        : 'The request could not be completed.',
    );
  }
  return data as Result;
}

export function write<Result>(
  path: string,
  body: object = {},
  method = 'POST',
  headers?: HeadersInit,
) {
  return api<Result>(path, {
    method,
    body: JSON.stringify(body),
    ...(headers ? { headers } : {}),
  });
}

export type Preferences = {
  name: string | null;
  timezone: string | null;
  language: string | null;
  browserLanguage: string;
  browserTimezone: string;
  appearance: 'light' | 'dark' | 'system';
  background: 'plain' | 'clouds';
  reduceEffects: boolean;
  showPredictions: boolean;
};
export type Company = { id: string; name: string; role: string };
export type Session = {
  userId: string;
  profile: Preferences;
  session: { email: string; name: string };
  companyList: { companies: Company[]; lastOpened: string | null };
  creditBalance: { available: string };
};

export const readSession = () =>
  write<Session>('/api/me/session', {}, 'POST', {
    'X-Brightwork-Page-Opening': '1',
    'X-Brightwork-Time-Zone': Intl.DateTimeFormat().resolvedOptions().timeZone,
  });

export const errorMessage = (error: unknown) =>
  error instanceof ApiError
    ? error.message
    : 'Something went wrong. Please try again.';

export function localReturnTo() {
  const candidate = new URLSearchParams(window.location.search).get('returnTo');
  if (!candidate?.startsWith('/') || candidate.startsWith('//')) return '/home';
  const url = new URL(candidate, window.location.origin);
  if (url.origin !== window.location.origin || url.pathname.startsWith('//'))
    return '/home';
  return url.pathname + url.search + url.hash;
}
