import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, write } from '../auth/client';
import type { Company } from '../auth/client';
import { Button } from '../ui/primitives';
import { workspacePath } from './session';
import styles from './growth.module.css';

const tools = {
  browser: 'Browser',
  leads: 'Leads',
  listing: 'Google listing',
  social: 'Social',
  ads: 'Ads & wallet',
} as const;
type Tool = keyof typeof tools;
type Capabilities = {
  leads: boolean;
  social: boolean;
  pageId: string | null;
  ads: boolean;
  google: boolean;
};
type Site = { title: string; url: string };
type Panel = {
  base: string;
  company: Company;
  canWrite: boolean;
  admin: boolean;
  caps: Capabilities;
};

function Link({ url, children }: { url: string; children: ReactNode }) {
  if (
    !URL.canParse(url) ||
    !['https:', 'http:'].includes(new URL(url).protocol)
  )
    return <span>{children}</span>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}
function Notice({ error, pending }: { error: unknown; pending?: boolean }) {
  return error ? (
    <p role="alert">{errorMessage(error)}</p>
  ) : pending ? (
    <p role="status">Working…</p>
  ) : null;
}
function submit(event: FormEvent<HTMLFormElement>, action: () => void) {
  event.preventDefault();
  action();
}

export function Growth({ company }: { company: Company }) {
  const base = `/api/companies/${company.id}/growth`;
  const selected =
    new URLSearchParams(location.search).get('tool') ?? 'browser';
  const tool: Tool = Object.hasOwn(tools, selected)
    ? (selected as Tool)
    : 'browser';
  const capability = useQuery({
    queryKey: [base],
    queryFn: () => api<Capabilities>(base),
    retry: false,
  });
  const panel = capability.data && {
    base,
    company,
    canWrite: company.role !== 'viewer',
    admin: ['owner', 'admin'].includes(company.role),
    caps: capability.data,
  };
  return (
    <section className={styles.growth} aria-labelledby="growth-title">
      <h1 id="growth-title">{tools[tool]}</h1>
      <nav aria-label="Growth tools">
        {Object.entries(tools).map(([key, label]) => (
          <a
            key={key}
            href={`${workspacePath(company.id, 'growth')}?tool=${key}`}
            aria-current={key === tool ? 'page' : undefined}
          >
            {label}
          </a>
        ))}
      </nav>
      <Notice error={capability.error} pending={capability.isPending} />
      {capability.isError && (
        <Button onClick={() => void capability.refetch()}>Retry</Button>
      )}
      {panel &&
        (tool === 'browser' ? (
          <Browser {...panel} />
        ) : tool === 'leads' ? (
          <Leads {...panel} />
        ) : tool === 'listing' ? (
          <Listing {...panel} />
        ) : tool === 'social' ? (
          <Social {...panel} />
        ) : (
          <Ads {...panel} />
        ))}
    </section>
  );
}

function Browser({ base, canWrite }: Panel) {
  const [url, setUrl] = useState('');
  const read = useMutation({
    mutationFn: () =>
      write<Site & { paragraphs: string[] }>(`${base}/browse`, { url }),
  });
  return (
    <>
      <form onSubmit={(event) => submit(event, () => read.mutate())}>
        <label>
          Public website URL
          <input
            type="url"
            required
            maxLength={2048}
            placeholder="https://example.com"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <Button type="submit" disabled={read.isPending || !canWrite}>
          Read page
        </Button>
      </form>
      <Notice error={read.error} pending={read.isPending} />
      {read.data && (
        <article>
          <h2>
            <Link url={read.data.url}>{read.data.title}</Link>
          </h2>
          {read.data.paragraphs.map((line, index) => (
            <p key={index}>{line}</p>
          ))}
        </article>
      )}
    </>
  );
}

function Leads({ base, canWrite, caps }: Panel) {
  const [query, setQuery] = useState('');
  const client = useQueryClient();
  const key = [base, 'leads'];
  const saved = useQuery({
    queryKey: key,
    queryFn: () =>
      api<{ leads: { id: string; title: string; body: string }[] }>(
        `${base}/leads`,
      ),
  });
  const search = useMutation({
    mutationFn: () =>
      write<{ hits: (Site & { excerpt: string | null })[] }>(
        `${base}/sources`,
        { query },
      ),
  });
  const save = useMutation({
    mutationFn: (hit: Site) =>
      write(`${base}/leads`, { url: hit.url, title: hit.title.slice(0, 150) }),
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
  });
  return (
    <>
      {!caps.leads && <p>Configure SearXNG to search for lead websites.</p>}
      <form onSubmit={(event) => submit(event, () => search.mutate())}>
        <label>
          Find public business websites
          <input
            required
            minLength={3}
            maxLength={250}
            placeholder="Independent coffee roasters in Perth"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <Button
          type="submit"
          disabled={search.isPending || !canWrite || !caps.leads}
        >
          Find leads
        </Button>
      </form>
      <Notice
        error={search.error || save.error || saved.error}
        pending={search.isPending || saved.isPending}
      />
      {search.data && (
        <section>
          <h2>Candidate websites</h2>
          {search.data.hits.length === 0 && <p>No candidate websites found.</p>}
          {search.data.hits.map((hit) => (
            <article key={hit.url}>
              <Link url={hit.url}>{hit.title}</Link>
              <p>{hit.url}</p>
              {hit.excerpt && <p>{hit.excerpt}</p>}
              <Button
                size="small"
                variant="secondary"
                disabled={
                  save.isPending ||
                  !canWrite ||
                  saved.data?.leads.some(({ body }) => body === hit.url)
                }
                onClick={() => save.mutate(hit)}
              >
                {saved.data?.leads.some(({ body }) => body === hit.url)
                  ? 'Saved'
                  : 'Save lead'}
              </Button>
            </article>
          ))}
        </section>
      )}
      <section>
        <h2>Saved leads</h2>
        {saved.data?.leads.length === 0 && <p>No saved leads yet.</p>}
        {saved.data?.leads.map((lead) => (
          <article key={lead.id}>
            <Link url={lead.body}>{lead.title.slice(6)}</Link>
          </article>
        ))}
      </section>
    </>
  );
}

type Post = {
  id: string;
  title: string;
  body: string;
  state: string;
  revision: number;
  publication: 'publishing' | 'published' | 'unknown' | null;
  remoteId: string | null;
  pageId: string | null;
};
function Social({ base, company, canWrite, admin, caps }: Panel) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const client = useQueryClient();
  const key = [base, 'posts'];
  const posts = useQuery({
    queryKey: key,
    queryFn: () => api<{ posts: Post[] }>(`${base}/posts`),
  });
  const draft = useMutation({
    mutationFn: () => write(`${base}/posts`, { title, body }),
    onSuccess: () => {
      setTitle('');
      setBody('');
      return client.invalidateQueries({ queryKey: key });
    },
  });
  const action = useMutation({
    mutationFn: ({
      post,
      action,
    }: {
      post: Post;
      action: 'approve' | 'reject' | 'publish';
    }) =>
      action === 'publish'
        ? write(`${base}/posts/${post.id}/publish`, {
            revision: post.revision,
            pageId: caps.pageId,
          })
        : write(`/api/companies/${company.id}/work/${post.id}/decision`, {
            revision: post.revision,
            approve: action === 'approve',
          }),
    onSettled: () => client.invalidateQueries({ queryKey: key }),
  });
  return (
    <>
      <p>
        Pip’s social drafts appear here for review.{' '}
        <a href={workspacePath(company.id, 'build')}>Ask Pip for a draft</a>.
      </p>
      <p>
        {caps.social
          ? `Publishing destination: Facebook Page ${caps.pageId}.`
          : 'Connect a Facebook Page to publish approved drafts.'}
      </p>
      <form onSubmit={(event) => submit(event, () => draft.mutate())}>
        <label>
          Draft title
          <input
            required
            maxLength={160}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label>
          Post text
          <textarea
            required
            rows={4}
            maxLength={4000}
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
        </label>
        <Button type="submit" disabled={!canWrite || draft.isPending}>
          Save for review
        </Button>
      </form>
      <Notice
        error={draft.error || posts.error || action.error}
        pending={posts.isPending || action.isPending}
      />
      {posts.data?.posts.map((post) => (
        <article key={post.id}>
          <h2>{post.title}</h2>
          <p className={styles.post}>{post.body}</p>
          <p>
            {post.publication === 'published'
              ? 'Published'
              : post.publication
                ? 'Publication needs confirmation on Facebook'
                : post.state}
          </p>
          {post.remoteId && (
            <Link
              url={`https://www.facebook.com/${encodeURIComponent(post.remoteId)}`}
            >
              Open Facebook post
            </Link>
          )}
          {admin && post.state === 'pending' && (
            <div className={styles.actions}>
              <Button
                variant="secondary"
                disabled={action.isPending}
                onClick={() => action.mutate({ post, action: 'approve' })}
              >
                Approve draft
              </Button>
              <Button
                variant="quiet"
                disabled={action.isPending}
                onClick={() => action.mutate({ post, action: 'reject' })}
              >
                Reject draft
              </Button>
            </div>
          )}
          {admin &&
            caps.social &&
            post.state === 'approved' &&
            !post.publication && (
              <Button
                disabled={action.isPending}
                onClick={() => {
                  if (
                    window.confirm(
                      `Publish this approved draft to Facebook Page ${caps.pageId}?`,
                    )
                  )
                    action.mutate({ post, action: 'publish' });
                }}
              >
                Publish to Facebook
              </Button>
            )}
        </article>
      ))}
    </>
  );
}

type ListingData = {
  title: string;
  locationId: string;
  profile?: { description?: string };
};
function Listing({ base, admin, caps }: Panel) {
  const [description, setDescription] = useState<string | null>(null);
  const listing = useQuery({
    queryKey: [base, 'listing'],
    queryFn: () => api<ListingData>(`${base}/listing`),
    enabled: admin && caps.google,
    retry: false,
  });
  const update = useMutation({
    mutationFn: (input: { description: string; locationId: string }) =>
      write<ListingData>(`${base}/listing`, input),
    onSuccess: async () => {
      await listing.refetch();
      setDescription(null);
    },
  });
  if (!admin || !caps.google)
    return (
      <p>
        {admin
          ? 'Connect a Google Business Profile location to view and update its description.'
          : 'An owner or admin can manage the Google listing.'}
      </p>
    );
  return (
    <>
      <Notice
        error={listing.error || update.error}
        pending={listing.isPending}
      />
      {listing.isError && (
        <Button onClick={() => void listing.refetch()}>Retry</Button>
      )}
      {listing.data && (
        <form
          onSubmit={(event) =>
            submit(event, () => {
              if (
                description !== null &&
                window.confirm(
                  `Update the public Google description for ${listing.data.title}?`,
                )
              )
                update.mutate({
                  description,
                  locationId: listing.data.locationId,
                });
            })
          }
        >
          <h2>{listing.data.title}</h2>
          <label>
            Business description
            <textarea
              rows={5}
              maxLength={750}
              value={description ?? listing.data.profile?.description ?? ''}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <Button
            type="submit"
            disabled={description === null || update.isPending}
          >
            Update Google listing
          </Button>
        </form>
      )}
      {update.isSuccess && <p role="status">Google accepted the update.</p>}
    </>
  );
}

type AdsData = {
  accountId: string;
  currency: string;
  spend: string;
  monthlyTarget: string | null;
  after: string | null;
  campaigns: {
    id: string;
    name: string;
    status: string;
    effective_status: string;
  }[];
};
function Ads({ base, admin, caps }: Panel) {
  const [cursor, setCursor] = useState('');
  const [target, setTarget] = useState<string | null>(null);
  const data = useQuery({
    queryKey: [base, 'ads', cursor],
    queryFn: () =>
      api<AdsData>(
        `${base}/ads${cursor ? '?' + new URLSearchParams({ after: cursor }) : ''}`,
      ),
    enabled: admin && caps.ads,
    retry: false,
  });
  const campaign = useMutation({
    mutationFn: ({
      id,
      status,
      accountId,
    }: {
      id: string;
      status: 'ACTIVE' | 'PAUSED';
      accountId: string;
    }) => write(`${base}/ads/${id}/status`, { status, accountId }),
    onSettled: () => data.refetch(),
  });
  const budget = useMutation({
    mutationFn: ({
      monthlyTarget,
      currency,
      accountId,
    }: {
      monthlyTarget: string;
      currency: string;
      accountId: string;
    }) => write(`${base}/wallet`, { monthlyTarget, currency, accountId }),
    onSuccess: async () => {
      await data.refetch();
      setTarget(null);
    },
  });
  if (!admin || !caps.ads)
    return (
      <p>
        {admin
          ? 'Connect a Meta ad account to manage campaigns and see reported spend.'
          : 'An owner or admin can manage ads and the wallet.'}
      </p>
    );
  const account = data.data;
  return (
    <>
      <Notice
        error={data.error || campaign.error || budget.error}
        pending={data.isPending}
      />
      {data.isError && (
        <Button onClick={() => void data.refetch()}>Retry</Button>
      )}
      {account && (
        <>
          <section>
            <h2>Ad wallet</h2>
            <p>
              Meta-reported spend this month:{' '}
              <strong>
                {account.spend} {account.currency}
              </strong>
              .
            </p>
            <p>
              The monthly target is for planning. Meta handles billing and
              campaign spending limits.
            </p>
            <form
              onSubmit={(event) =>
                submit(event, () => {
                  if (target !== null)
                    budget.mutate({
                      monthlyTarget: target,
                      currency: account.currency,
                      accountId: account.accountId,
                    });
                })
              }
            >
              <label>
                Monthly target ({account.currency})
                <input
                  inputMode="decimal"
                  required
                  pattern="[0-9]{1,9}(\.[0-9]{1,2})?"
                  value={target ?? account.monthlyTarget ?? ''}
                  onChange={(event) => setTarget(event.target.value)}
                />
              </label>
              <Button
                type="submit"
                disabled={budget.isPending || target === null}
              >
                Save target
              </Button>
            </form>
            <Link
              url={`https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${account.accountId}`}
            >
              Open Meta Ads Manager for creative, billing, or new campaigns
            </Link>
          </section>
          <section>
            <h2>Meta campaigns</h2>
            <p>Ad account {account.accountId}</p>
            {!account.campaigns.length && <p>No campaigns on this page.</p>}
            {account.campaigns.map(({ id, name, status, effective_status }) => (
              <article key={id}>
                <h3>{name}</h3>
                <p>
                  {status} · Delivery: {effective_status}
                </p>
                {(status === 'ACTIVE' || status === 'PAUSED') && (
                  <Button
                    variant="secondary"
                    disabled={campaign.isPending}
                    onClick={() => {
                      const next = status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
                      if (
                        window.confirm(
                          next === 'ACTIVE'
                            ? `Resume ${name} on Meta? It may start spending under its Meta budget.`
                            : `Pause ${name} on Meta?`,
                        )
                      )
                        campaign.mutate({
                          id,
                          status: next,
                          accountId: account.accountId,
                        });
                    }}
                  >
                    {status === 'ACTIVE' ? 'Pause campaign' : 'Resume campaign'}
                  </Button>
                )}
              </article>
            ))}
            <div className={styles.actions}>
              {cursor && (
                <Button variant="secondary" onClick={() => setCursor('')}>
                  First page
                </Button>
              )}
              {account.after && (
                <Button
                  variant="secondary"
                  onClick={() => setCursor(account.after ?? '')}
                >
                  Next page
                </Button>
              )}
            </div>
          </section>
        </>
      )}
    </>
  );
}
