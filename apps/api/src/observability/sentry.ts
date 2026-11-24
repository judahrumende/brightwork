export type SentryOptions = {
  dsn: string | undefined;
  environment: string | undefined;
  service: string;
};

export type SentryInitResult =
  { enabled: false; reason: 'unset' | 'missing_module' } | { enabled: true };

/**
 * Load @sentry/node only when SENTRY_DSN is set.
 * Missing package with a DSN set disables Sentry and returns missing_module.
 */
export async function initSentry(
  options: SentryOptions,
): Promise<SentryInitResult> {
  const dsn = options.dsn?.trim();
  if (!dsn) return { enabled: false, reason: 'unset' };
  try {
    // Variable specifier keeps typecheck green when @sentry/node is not installed.
    const specifier = '@sentry/node';
    const sentry = (await import(specifier)) as {
      init: (initOptions: {
        dsn: string;
        environment?: string;
        initialScope?: { tags?: Record<string, string> };
      }) => void;
    };
    const environment = options.environment?.trim();
    sentry.init({
      dsn,
      ...(environment ? { environment } : {}),
      initialScope: { tags: { service: options.service } },
    });
    return { enabled: true };
  } catch {
    return { enabled: false, reason: 'missing_module' };
  }
}
