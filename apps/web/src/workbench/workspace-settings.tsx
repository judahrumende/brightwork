import { CommerceHistoryRefresh } from './commerce-history-refresh';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Company } from '../auth/client';
import { api, errorMessage, write } from '../auth/client';
import { Button } from '../ui/primitives';
import { StripeSeller } from './stripe-seller';
import { SmsSettings } from './sms-settings';
import styles from './workbench.module.css';

type Role = 'admin' | 'member' | 'viewer';
type Team = {
  members: {
    id: string;
    name: string | null;
    email: string;
    role: Role | 'owner';
  }[];
  invites: { id: string; email: string; role: Role }[];
};

const roleChoices = (owner: boolean) => (
  <>
    <option value="viewer">View only</option>
    <option value="member">Member</option>
    {owner && <option value="admin">Admin</option>}
  </>
);

export function WorkspaceSettings({
  company,
  accountId,
}: {
  company: Company;
  accountId: string;
}) {
  const [tab, setTab] = useState<
    'team' | 'vault' | 'domains' | 'commerce' | 'sms'
  >('team');
  const endpoint = `/api/companies/${company.id}/settings`;
  if (!['owner', 'admin'].includes(company.role))
    return (
      <section className={styles.view}>
        <h1>Workspace settings</h1>
        <p>An owner or admin manages workspace settings.</p>
      </section>
    );
  return (
    <section className={styles.view}>
      <h1>Workspace settings</h1>
      <nav aria-label="Workspace settings sections">
        <Button
          variant="secondary"
          aria-pressed={tab === 'team'}
          onClick={() => setTab('team')}
        >
          Team
        </Button>
        <Button
          variant="secondary"
          aria-pressed={tab === 'vault'}
          onClick={() => setTab('vault')}
        >
          Vault
        </Button>
        <Button
          variant="secondary"
          aria-pressed={tab === 'domains'}
          onClick={() => setTab('domains')}
        >
          Domains
        </Button>
        <Button
          variant="secondary"
          aria-pressed={tab === 'commerce'}
          onClick={() => setTab('commerce')}
        >
          Commerce
        </Button>
        <Button
          variant="secondary"
          aria-pressed={tab === 'sms'}
          onClick={() => setTab('sms')}
        >
          SMS
        </Button>
      </nav>
      {tab === 'team' && (
        <TeamSettings
          endpoint={endpoint + '/team'}
          owner={company.role === 'owner'}
          accountId={accountId}
        />
      )}
      {tab === 'vault' && <VaultSettings endpoint={endpoint + '/vault'} />}
      {tab === 'domains' && <DomainSettings endpoint={endpoint + '/domains'} />}
      {tab === 'sms' && <SmsSettings endpoint={endpoint + '/sms'} />}
      {tab === 'commerce' && (
        <>
          <CommerceSettings endpoint={endpoint + '/shopify'} />
          <StripeSeller endpoint={endpoint + '/stripe-connect'} />
        </>
      )}
    </section>
  );
}

function TeamSettings({
  endpoint,
  owner,
  accountId,
}: {
  endpoint: string;
  owner: boolean;
  accountId: string;
}) {
  const cache = useQueryClient();
  const key = ['workspace-settings', endpoint];
  const team = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<Team>(endpoint, { signal }),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function save(
    path: string,
    body: object,
    method: string,
    confirmation: string,
  ) {
    if (busy) return false;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await write(endpoint + path, body, method);
      await cache.invalidateQueries({ queryKey: key });
      setMessage(confirmation);
      return true;
    } catch (failure) {
      setError(errorMessage(failure));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (
      await save(
        '/invitations',
        Object.fromEntries(new FormData(form)),
        'POST',
        'Invitation saved. The recipient can accept from Home.',
      )
    )
      form.reset();
  }
  return (
    <section aria-label="Team members">
      <h2>Team</h2>
      <form
        className={styles.taskForm}
        onSubmit={(event) => void invite(event)}
      >
        <label>
          Invite by email{' '}
          <input name="email" type="email" required maxLength={254} />
        </label>
        <label>
          Invitation role{' '}
          <select name="role" defaultValue="member">
            {roleChoices(owner)}
          </select>
        </label>
        <Button disabled={busy} type="submit">
          Create invitation
        </Button>
      </form>
      {team.isPending && <p role="status">Loading team…</p>}
      {team.isError && <p role="alert">{errorMessage(team.error)}</p>}
      <ul>
        {team.data?.members.map((person) => (
          <li key={person.id}>
            <strong>{person.name ?? person.email}</strong>
            {' · '}
            {person.role}
            {person.id !== accountId &&
              person.role !== 'owner' &&
              (owner || person.role !== 'admin') && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const role = new FormData(event.currentTarget).get('role');
                    void save(
                      '/members/' + person.id,
                      { role: role || null },
                      'PATCH',
                      'Membership updated.',
                    );
                  }}
                >
                  <label>
                    Role for {person.email}{' '}
                    <select name="role" defaultValue={person.role}>
                      {roleChoices(owner)}
                      <option value="">Remove access</option>
                    </select>
                  </label>
                  <Button type="submit" size="small" disabled={busy}>
                    Save role
                  </Button>
                </form>
              )}
          </li>
        ))}
      </ul>
      <h3>Pending invitations</h3>
      {team.data?.invites.length === 0 && <p>No pending invitations.</p>}
      <ul>
        {team.data?.invites.map((item) => (
          <li key={item.id}>
            {item.email} · {item.role}{' '}
            {(owner || item.role !== 'admin') && (
              <Button
                variant="quiet"
                size="small"
                disabled={busy}
                onClick={() =>
                  void save(
                    '/invitations/' + item.id,
                    {},
                    'DELETE',
                    'Invitation cancelled.',
                  )
                }
              >
                Cancel invitation
              </Button>
            )}
          </li>
        ))}
      </ul>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

function VaultSettings({ endpoint }: { endpoint: string }) {
  const cache = useQueryClient();
  const key = ['workspace-settings', endpoint];
  const vault = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      api<{ enabled: boolean; credentials: { id: string; name: string }[] }>(
        endpoint,
        { signal },
      ),
  });
  const [reveal, setReveal] = useState<{ id: string; value: string } | null>(
    null,
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function change(
    path: string,
    body: object,
    method = 'POST',
    id?: string,
  ) {
    if (busy) return false;
    setBusy(true);
    setError('');
    setReveal(null);
    try {
      const result = await write<{ value?: string }>(
        endpoint + path,
        body,
        method,
      );
      if (id && result.value) setReveal({ id, value: result.value });
      else await cache.invalidateQueries({ queryKey: key });
      return true;
    } catch (failure) {
      setError(errorMessage(failure));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (await change('', Object.fromEntries(new FormData(form)))) form.reset();
  }
  return (
    <section aria-label="Credential vault">
      <h2>Credential vault</h2>
      {vault.isPending && <p role="status">Loading vault…</p>}
      {vault.isError && <p role="alert">{errorMessage(vault.error)}</p>}
      {vault.data && !vault.data.enabled && (
        <p>Configure the vault encryption key to use this feature.</p>
      )}
      {vault.data?.enabled && (
        <form
          className={styles.taskForm}
          onSubmit={(event) => void save(event)}
        >
          <label>
            Credential name <input name="name" required maxLength={100} />
          </label>
          <label>
            Credential value{' '}
            <input
              name="value"
              type="password"
              autoComplete="off"
              required
              maxLength={8192}
            />
          </label>
          <Button type="submit" disabled={busy}>
            Save credential
          </Button>
        </form>
      )}
      <ul>
        {vault.data?.credentials.map((item) => (
          <li key={item.id}>
            <strong>{item.name}</strong>{' '}
            <Button
              variant="quiet"
              size="small"
              disabled={busy}
              onClick={() =>
                reveal?.id === item.id
                  ? setReveal(null)
                  : void change('/' + item.id + '/reveal', {}, 'POST', item.id)
              }
            >
              {reveal?.id === item.id ? 'Hide credential' : 'Reveal credential'}
            </Button>
            <Button
              variant="quiet"
              size="small"
              disabled={busy}
              onClick={() => void change('/' + item.id, {}, 'DELETE')}
            >
              Delete credential
            </Button>
            {reveal?.id === item.id && (
              <p>
                <code>{reveal.value}</code>
              </p>
            )}
          </li>
        ))}
      </ul>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

function DomainSettings({ endpoint }: { endpoint: string }) {
  const cache = useQueryClient();
  const key = ['workspace-settings', endpoint];
  const domains = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      api<{
        domains: {
          id: string;
          hostname: string;
          challenge: string;
          verifiedAt: string | null;
        }[];
      }>(endpoint, { signal }),
  });
  const [hostname, setHostname] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function change(path: string, body: object, method = 'POST') {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await write(endpoint + path, body, method);
      if (!path) setHostname('');
      await cache.invalidateQueries({ queryKey: key });
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Workspace domains">
      <h2>Domains</h2>
      <form
        className={styles.taskForm}
        onSubmit={(event) => {
          event.preventDefault();
          void change('', { hostname });
        }}
      >
        <label>
          Domain name{' '}
          <input
            value={hostname}
            required
            maxLength={253}
            onChange={(event) => setHostname(event.currentTarget.value)}
          />
        </label>
        <Button type="submit" disabled={busy}>
          Add domain
        </Button>
      </form>
      {domains.isPending && <p role="status">Loading domains…</p>}
      {domains.isError && <p role="alert">{errorMessage(domains.error)}</p>}
      {domains.data?.domains.map((domain) => (
        <article key={domain.id}>
          <h3>{domain.hostname}</h3>
          {domain.verifiedAt ? (
            <p>Domain ownership verified</p>
          ) : (
            <>
              <p>Add a TXT record to verify this domain.</p>
              <dl>
                <dt>Record name</dt>
                <dd>
                  <code>_brightwork-verification.{domain.hostname}</code>
                </dd>
                <dt>TXT value</dt>
                <dd>
                  <code>{domain.challenge}</code>
                </dd>
              </dl>
              <Button
                size="small"
                disabled={busy}
                onClick={() => void change('/' + domain.id + '/verify', {})}
              >
                Verify domain
              </Button>
            </>
          )}
          <Button
            size="small"
            disabled={busy}
            variant="quiet"
            onClick={() => void change('/' + domain.id, {}, 'DELETE')}
          >
            Remove domain
          </Button>
        </article>
      ))}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

function CommerceSettings({ endpoint }: { endpoint: string }) {
  const cache = useQueryClient();
  const key = ['workspace-settings', endpoint];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const commerce = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      api<{
        enabled: boolean;
        shops: { id: string; shop: string; connected: boolean }[];
        totals: {
          shop: string;
          currency: string;
          orders: number;
          orderValue: string;
        }[];
      }>(endpoint, { signal }),
  });

  async function change(path: string, body: object, method = 'POST') {
    if (busy) return false;
    setBusy(true);
    setError('');
    try {
      await write(endpoint + path, body, method);
      await cache.invalidateQueries({ queryKey: key });
      return true;
    } catch (failure) {
      setError(errorMessage(failure));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (await change('', Object.fromEntries(new FormData(form)))) form.reset();
  }

  return (
    <section aria-label="Shopify stores">
      <h2>Shopify</h2>
      {commerce.isPending && <p role="status">Loading Shopify stores…</p>}
      {commerce.isError && <p role="alert">{errorMessage(commerce.error)}</p>}
      {commerce.data && !commerce.data.enabled && (
        <p>Shopify connections are unavailable.</p>
      )}
      {commerce.data?.enabled && (
        <form
          className={styles.taskForm}
          onSubmit={(event) => void connect(event)}
        >
          <label>
            Store domain
            <input
              name="shop"
              placeholder="store.myshopify.com"
              required
              maxLength={77}
            />
          </label>
          <label>
            Admin API token
            <input
              name="token"
              type="password"
              autoComplete="off"
              required
              maxLength={512}
            />
          </label>
          <label>
            Webhook signing secret
            <input
              name="secret"
              type="password"
              autoComplete="off"
              required
              maxLength={512}
            />
          </label>
          <Button type="submit" disabled={busy}>
            Connect or update store
          </Button>
        </form>
      )}
      {commerce.data?.shops.map((store) => (
        <article key={store.id}>
          <h3>{store.shop}</h3>
          {store.connected ? (
            <>
              <p>Add this URL to your Shopify order webhook subscriptions.</p>
              <p>
                <code>
                  {location.origin}/api/webhooks/shopify/{store.id}
                </code>
              </p>
              <Button
                variant="quiet"
                size="small"
                disabled={busy}
                onClick={() => void change('/' + store.id, {}, 'DELETE')}
              >
                Disconnect
              </Button>
              <CommerceHistoryRefresh
                endpoint={endpoint + '/' + store.id}
                queryKey={key}
              />
            </>
          ) : (
            <p>Disconnected</p>
          )}
          {commerce.data?.totals
            .filter((total) => total.shop === store.shop)
            .map((total) => (
              <p key={total.currency}>
                Paid order value received by Brightwork{' '}
                {new Intl.NumberFormat(undefined, {
                  style: 'currency',
                  currency: total.currency,
                }).format(Number(total.orderValue))}
                {' · '}
                {total.orders} {total.orders === 1 ? 'order' : 'orders'}
              </p>
            ))}
        </article>
      ))}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
