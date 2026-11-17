import * as Dialog from '@radix-ui/react-dialog';
import * as Popover from '@radix-ui/react-popover';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { Preferences, Session } from '../auth/client';
import { api, errorMessage, write } from '../auth/client';
import { Button } from '../ui/primitives';
import { Sky } from '../sky/sky';
import { creditKey, sessionKey } from './session';
import styles from './workbench.module.css';
import { BillingSettings } from './billing-settings';

const creditLabels = {
  starter: 'Starter credits',
  model: 'Pip model call',
  tool: 'Pip tool call',
  subscription: 'Subscription credits',
  refund: 'Refund credit adjustment',
};

function CreditHistory({ available }: { available: string }) {
  const history = useQuery({
    queryKey: [...creditKey, 'history'],
    queryFn: () =>
      api<{
        entries: {
          id: string;
          kind: keyof typeof creditLabels;
          amount: string;
          createdAt: string;
        }[];
      }>('/api/me/credits/history'),
  });
  const dates = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  return (
    <div className={styles.creditHistory}>
      <div className={styles.creditCard}>
        <small>Available credits</small>
        <strong>{available}</strong>
      </div>
      {history.isPending && <p role="status">Loading credit history…</p>}
      {history.isError && (
        <div role="alert">
          <p>{errorMessage(history.error)}</p>
          <Button variant="secondary" onClick={() => void history.refetch()}>
            Try again
          </Button>
        </div>
      )}
      {history.data && (
        <table>
          <caption>Recent credit transactions</caption>
          <thead>
            <tr>
              <th scope="col">Activity</th>
              <th scope="col">Date</th>
              <th scope="col">Credits</th>
            </tr>
          </thead>
          <tbody>
            {history.data.entries.map((entry) => (
              <tr key={entry.id}>
                <td>{creditLabels[entry.kind]}</td>
                <td>
                  <time dateTime={entry.createdAt}>
                    {dates.format(new Date(entry.createdAt))}
                  </time>
                </td>
                <td>{entry.amount}</td>
              </tr>
            ))}
            {history.data.entries.length === 0 && (
              <tr>
                <td colSpan={3}>No credit transactions yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function Profile({ session }: { session: Session }) {
  const query = useQueryClient();
  const { profile, session: account } = session;
  const [menu, setMenu] = useState(false);
  const [settings, setSettings] = useState(false);
  const [section, setSection] = useState<'Account' | 'Credits' | 'Billing'>(
    'Account',
  );
  const balance = useQuery({
    queryKey: creditKey,
    queryFn: () => api<{ available: string }>('/api/me/credits'),
    enabled: menu || settings,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState(profile.name ?? account.name);
  const initials =
    (profile.name ?? account.name ?? account.email)
      .trim()
      .slice(0, 1)
      .toUpperCase() || account.email[0]?.toUpperCase();
  const display = profile.name ?? (account.name || account.email.split('@')[0]);
  const available = balance.data?.available ?? session.creditBalance.available;

  async function update(patch: Partial<Preferences>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const { profile: updated } = await write<{ profile: Preferences }>(
        '/api/me/account',
        patch,
        'PATCH',
      );
      query.setQueryData<Session>(sessionKey, (current) =>
        current ? { ...current, profile: updated } : current,
      );
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await write('/api/auth/sign-out');
      location.replace('/signed-out');
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }

  function showSettings(target: typeof section = 'Account') {
    setName(profile.name ?? account.name);
    setError('');
    setSection(target);
    setMenu(false);
    setSettings(true);
  }

  return (
    <>
      <Popover.Root open={menu} onOpenChange={setMenu}>
        <Popover.Trigger aria-label="Account menu" className={styles.avatar}>
          {initials}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="end"
            sideOffset={10}
            collisionPadding={10}
            className={styles.profileMenu}
          >
            <button className={styles.identity} onClick={() => showSettings()}>
              <span className={styles.avatar}>{initials}</span>
              <span>
                <strong>{display}</strong>
                <small>{account.email}</small>
              </span>
              <span aria-hidden="true">›</span>
            </button>
            <button
              className={styles.creditCard}
              onClick={() => showSettings('Credits')}
            >
              <small>Available credits</small>
              <strong>
                {Number(available).toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })}
              </strong>
            </button>
            <button className={styles.menuRow} onClick={() => showSettings()}>
              Settings <span aria-hidden="true">›</span>
            </button>
            <div className={styles.menuRow}>
              <span>Appearance</span>
              <div className={styles.themeChoices} aria-label="Appearance">
                {(
                  [
                    ['light', '☼', 'Light'],
                    ['dark', '☾', 'Dark'],
                    ['system', '▣', 'System'],
                  ] as const
                ).map(([key, icon, label]) => (
                  <button
                    key={key}
                    aria-label={label}
                    title={label}
                    aria-pressed={profile.appearance === key}
                    disabled={busy}
                    onClick={() => {
                      void update({ appearance: key });
                    }}
                  >
                    {icon}
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.wallpapers} aria-label="Wallpaper">
              {(['plain', 'clouds'] as const).map((key) => (
                <button
                  key={key}
                  disabled={busy}
                  aria-pressed={profile.background === key}
                  onClick={() => {
                    void update({ background: key });
                  }}
                >
                  <span className={styles.wallpaperTile}>
                    <Sky plain={key === 'plain'} reduceEffects />
                    <span />
                    <span />
                  </span>
                  <span>{key === 'plain' ? 'Plain' : 'Clouds'}</span>
                </button>
              ))}
            </div>
            <hr />
            <button
              className={styles.menuRow}
              disabled={busy}
              onClick={() => {
                void logout();
              }}
            >
              Log out
            </button>
            {error && (
              <p className={styles.alert} role="alert">
                {error}
              </p>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <Dialog.Root open={settings} onOpenChange={setSettings}>
        <Dialog.Portal>
          <Dialog.Overlay className={styles.scrim} />
          <Dialog.Content
            className={styles.accountDialog}
            aria-describedby={undefined}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              document
                .querySelector<HTMLButtonElement>(
                  'button[aria-label="Account menu"]',
                )
                ?.focus();
            }}
          >
            <aside>
              <strong>Settings</strong>
              <nav className={styles.settingsNav} aria-label="Settings">
                {(['Account', 'Credits', 'Billing'] as const).map((item) => (
                  <button
                    type="button"
                    key={item}
                    onClick={() => setSection(item)}
                    aria-current={section === item ? 'page' : undefined}
                  >
                    {item}
                  </button>
                ))}
              </nav>
            </aside>
            <div className={styles.accountBody}>
              <header>
                <Dialog.Title>{section}</Dialog.Title>
                <Dialog.Close asChild>
                  <Button
                    size="icon"
                    variant="quiet"
                    aria-label="Close settings"
                  >
                    ×
                  </Button>
                </Dialog.Close>
              </header>
              {section === 'Credits' ? (
                <CreditHistory available={available} />
              ) : section === 'Billing' ? (
                <BillingSettings />
              ) : (
                <>
                  <div className={styles.accountCard}>
                    <div className={styles.accountIdentity}>
                      <span className={styles.avatar}>{initials}</span>
                      <div>
                        <h2>{display}</h2>
                        <p>{account.email}</p>
                      </div>
                    </div>
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        void update({ name: name.trim() || null });
                      }}
                    >
                      <label htmlFor="account-name">Full name</label>
                      <span>
                        <input
                          id="account-name"
                          value={name}
                          maxLength={100}
                          onChange={(event) =>
                            setName(event.currentTarget.value)
                          }
                        />
                        <Button
                          size="small"
                          type="submit"
                          disabled={
                            busy ||
                            name.trim() === (profile.name ?? account.name)
                          }
                        >
                          Save
                        </Button>
                      </span>
                    </form>
                    <label>
                      Email{' '}
                      <input type="email" readOnly value={account.email} />
                    </label>
                    <label>
                      Your local time
                      <select
                        value={profile.timezone ?? ''}
                        disabled={busy}
                        onChange={(event) => {
                          void update({
                            timezone: event.currentTarget.value || null,
                          });
                        }}
                      >
                        <option value="">
                          Automatic ({profile.browserTimezone})
                        </option>
                        {[
                          ...new Set([
                            profile.browserTimezone,
                            'UTC',
                            'Australia/Perth',
                            'Australia/Sydney',
                            'Europe/London',
                            'America/New_York',
                            ...(profile.timezone ? [profile.timezone] : []),
                          ]),
                        ].map((zone) => (
                          <option key={zone}>{zone}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Language
                      <select
                        value={profile.language ?? ''}
                        disabled={busy}
                        onChange={(event) => {
                          void update({
                            language: event.currentTarget.value || null,
                          });
                        }}
                      >
                        <option value="">
                          Automatic ({profile.browserLanguage})
                        </option>
                        <option value="en-US">English (US)</option>
                        <option value="en-AU">English (Australia)</option>
                        <option value="en-GB">English (UK)</option>
                      </select>
                    </label>
                  </div>
                  <h2 className={styles.preferencesHeading}>Preferences</h2>
                  <div className={styles.accountCard}>
                    <label>
                      <span>Show notification badges</span>
                      <input
                        type="checkbox"
                        checked={profile.showNotificationBadges !== false}
                        disabled={busy}
                        onChange={(event) =>
                          void update({
                            showNotificationBadges: event.currentTarget.checked,
                          })
                        }
                      />
                    </label>
                    <label>
                      <span>
                        Show predictions
                        <small>Suggest the next message in the composer.</small>
                      </span>
                      <input
                        type="checkbox"
                        checked={profile.showPredictions}
                        disabled={busy}
                        onChange={(event) => {
                          void update({
                            showPredictions: event.currentTarget.checked,
                          });
                        }}
                      />
                    </label>
                    <label>
                      <span>
                        Reduce effects
                        <small>Keep decorative effects still.</small>
                      </span>
                      <input
                        type="checkbox"
                        checked={profile.reduceEffects}
                        disabled={busy}
                        onChange={(event) => {
                          void update({
                            reduceEffects: event.currentTarget.checked,
                          });
                        }}
                      />
                    </label>
                  </div>
                  {error && (
                    <p className={styles.alert} role="alert">
                      {error}
                    </p>
                  )}
                </>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
