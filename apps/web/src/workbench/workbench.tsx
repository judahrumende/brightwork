import * as Dialog from '@radix-ui/react-dialog';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { brand } from '@brightwork/shared';
import { api, write } from '../auth/client';
import type { Company, Session } from '../auth/client';
import { Sky } from '../sky/sky';
import { Icon, Mascot } from '../ui/icons';
import { FloatingPanel } from '../ui/overlays';
import { Button, EmptyState } from '../ui/primitives';
import { Notifications, PipActivity } from './activity';
import { Profile } from './profile';
import {
  PipChat,
  WorkList,
  artifactLink,
  useWorkspaceSummary,
  type WorkSummary,
} from './agent';
import { usePreferences, usePresence, workspacePath } from './session';
import { pageViewSeries } from './traffic-series';
import { Runs } from './runs';
import { ReceivedMail } from './received-mail';
import { WorkspaceFiles } from './workspace-files';
import { WorkspaceSettings } from './workspace-settings';
import { WebSearch } from './web-search';
import { Growth } from './growth';
import { useTraffic, Visitors } from './visitors';
import styles from './workbench.module.css';

export const workspaceViews = [
  'home',
  'build',
  'run',
  'inbox',
  'schedule',
  'library',
  'research',
  'growth',
  'settings',
] as const;
export type WorkspaceView = (typeof workspaceViews)[number];
const labels: Record<WorkspaceView, string> = {
  home: 'Home',
  build: 'Build',
  run: 'Run',
  inbox: 'Inbox',
  schedule: 'Schedule',
  library: 'Library',
  research: 'Research',
  growth: 'Growth',
  settings: 'Settings',
};
const dock = [
  ['Research', 'search', '#007af2', 'Research history'],
  ['Browser', 'globe', '#555b64', 'Browsing history'],
  ['Outreach', 'mail', '#00a9da', 'Outreach drafts'],
  ['Social', 'heart', '#ee3e6d', 'Social drafts'],
  ['Build', 'box', '#00a99e', 'Websites', 'build'],
  ['Ads', 'ad', '#ec8a00', 'Ad drafts'],
  ['Messages', 'message', '#23b651', 'Messages', 'inbox'],
  ['Documents', 'pen', '#edb500', 'Documents', 'library'],
  ['Image', 'image', '#079ae3', 'Images', 'library'],
  ['Videos', 'film', '#f55750', 'Videos', 'library'],
  ['Schedule', 'list', '#515861', 'Scheduled tasks', 'schedule'],
  ['Library', 'folder', '#108bfa', 'Library', 'library'],
  ['Settings', 'settings', '#858c95', 'Account and workspace preferences'],
] as const;
const growthDock = new Map<string, string>([
  ['Browser', 'browser'],
  ['Social', 'social'],
  ['Ads', 'ads'],
]);

const dockKinds: Partial<Record<string, WorkSummary['kind']>> = {
  Outreach: 'email',
  Build: 'website',
  Messages: 'question',
  Documents: 'document',
  Schedule: 'task',
};

function Dock({
  company,
  items,
  unavailable,
}: {
  company: Company;
  items: readonly WorkSummary[] | undefined;
  unavailable: boolean;
}) {
  return (
    <nav className={styles.dock} aria-label="Workspace applications">
      {dock.map(([label, icon, color, section, view]) => {
        const tool = growthDock.get(label);
        const work =
          items?.filter((item) =>
            label === 'Library'
              ? ['document', 'memory'].includes(item.kind)
              : item.kind === dockKinds[label],
          ) ?? [];
        const inRun = work.filter((item) => item.inRun);
        const other = work.filter((item) => !item.inRun);
        const tracksWork = label === 'Library' || Boolean(dockKinds[label]);
        const destination = label === 'Outreach' ? 'inbox' : view;
        return label === 'Research' || label === 'Settings' || tool ? (
          <a
            key={label}
            className={styles.dockButton}
            href={
              tool
                ? `${workspacePath(company.id, 'growth')}?tool=${tool}`
                : workspacePath(
                    company.id,
                    label === 'Settings' ? 'settings' : 'research',
                  )
            }
          >
            <span style={{ backgroundColor: color }}>
              <Icon name={icon} size={25} />
            </span>
            {label}
          </a>
        ) : (
          <FloatingPanel
            key={label}
            label={label}
            side="top"
            width={340}
            trigger={
              <button
                className={styles.dockButton}
                data-in-run={inRun.length > 0 || undefined}
              >
                <span style={{ backgroundColor: color }}>
                  <Icon name={icon} size={25} />
                </span>
                {label}
              </button>
            }
          >
            <h3 className={styles.popoverTitle}>{label}</h3>
            {
              <>
                {work.length === 0 && (
                  <EmptyState
                    icon={<Icon name={icon} size={38} />}
                    title={
                      tracksWork && !items
                        ? unavailable
                          ? 'Saved work is unavailable'
                          : 'Loading saved work…'
                        : `No ${section.toLowerCase()} yet`
                    }
                  />
                )}
                {(
                  [
                    ['In Run', inRun],
                    ['Recent work', other],
                  ] as const
                ).map(
                  ([title, rows]) =>
                    rows.length > 0 && (
                      <section
                        key={title}
                        aria-label={title}
                        className={styles.dockWork}
                      >
                        <h4>{title}</h4>
                        <ul className={styles.activityLinks}>
                          {rows.slice(0, 4).map((item) => (
                            <li key={item.id}>
                              <a href={artifactLink(company.id, item)}>
                                {item.title}
                                <Icon name="arrow" />
                              </a>
                            </li>
                          ))}
                        </ul>
                      </section>
                    ),
                )}
                {destination && (
                  <Button asChild size="small" variant="secondary">
                    <a href={workspacePath(company.id, destination)}>
                      Open {labels[destination]}
                    </a>
                  </Button>
                )}
              </>
            }
          </FloatingPanel>
        );
      })}
    </nav>
  );
}

function Clock({ timezone }: { timezone: string }) {
  const [current, setCurrent] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setCurrent(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const output = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
  }).format(current);
  return <time dateTime={current.toISOString()}>{output}</time>;
}

function Home({
  company,
  timezone,
  onSearch,
  items,
  unavailable,
}: {
  company: Company;
  timezone: string;
  onSearch: () => void;
  items: readonly WorkSummary[] | undefined;
  unavailable: boolean;
}) {
  const traffic = useTraffic(company.id);
  const pageViews = pageViewSeries(
    traffic.data?.daily ?? [],
    'last_7_days',
    new Date(),
  ).reduce((total, day) => total + day.views, 0);
  const [showVisitors, setShowVisitors] = useState(false);
  const visitorsLink = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (!showVisitors && restoreFocus.current) {
      visitorsLink.current?.focus();
      restoreFocus.current = false;
    }
  }, [showVisitors]);
  if (showVisitors) {
    return (
      <Visitors
        traffic={traffic}
        onBack={() => {
          restoreFocus.current = true;
          setShowVisitors(false);
        }}
      />
    );
  }
  return (
    <>
      <div className={styles.homeGrid}>
        <section className={styles.desktop} aria-label="Desktop">
          <div className={styles.desktopToolbar}>
            <button onClick={onSearch}>
              <Mascot size={13} /> Find a tool
            </button>
            <Clock timezone={timezone} />
          </div>
          <div className={styles.waiting}>
            <Mascot size={16} /> Ready when you are
          </div>
          <Dock company={company} items={items} unavailable={unavailable} />
        </section>
        <PipActivity companyId={company.id} items={items} />
      </div>
      <section className={styles.metrics} aria-label="Business overview">
        <article>
          <h2>Build</h2>
          <p>Websites and drafts</p>
          <Button asChild variant="secondary">
            <a href={workspacePath(company.id, 'build')}>Open Build</a>
          </Button>
        </article>
        <article>
          <h2>Revenue</h2>
          <EmptyState
            title="No revenue yet"
            description="Sales and payments will appear here."
          />
        </article>
        <article>
          <h2>Visitors</h2>
          {traffic.data ? (
            <p>{pageViews.toLocaleString()} page views in the last 7 days.</p>
          ) : (
            <p>
              {traffic.isError
                ? 'Website traffic is unavailable.'
                : 'Loading traffic…'}
            </p>
          )}
          <Button
            ref={visitorsLink}
            variant="secondary"
            onClick={() => setShowVisitors(true)}
          >
            View website traffic
          </Button>
        </article>
        <article>
          <h2>Insights</h2>
          <EmptyState
            title="No activity to report"
            description="Your business activity will appear here."
          />
        </article>
      </section>
    </>
  );
}

function Search({
  company,
  open,
  setOpen,
}: {
  company: Company;
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const [value, setValue] = useState('');
  const query = value.trim();
  const [request, setRequest] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setRequest(query), 180);
    return () => clearTimeout(timer);
  }, [query]);
  const active = open && query.length >= 2 && request === query;
  const saved = useQuery({
    queryKey: ['search-work', company.id, request],
    enabled: active,
    queryFn: ({ signal }) =>
      api<{
        items: (Pick<WorkSummary, 'id' | 'kind' | 'title'> & {
          businessId: string;
          businessName: string;
        })[];
      }>(
        '/api/me/search-work?' +
          new URLSearchParams({ q: request, current: company.id }),
        { signal },
      ),
  });
  const matches = workspaceViews.filter((view) =>
    labels[view].toLowerCase().includes(value.trim().toLowerCase()),
  );
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.scrim} />
        <Dialog.Content className={styles.palette} aria-describedby={undefined}>
          <Dialog.Title>Search your workspaces</Dialog.Title>
          <input
            aria-label="Search views and saved work"
            value={value}
            autoComplete="off"
            maxLength={120}
            onChange={(event) => setValue(event.currentTarget.value)}
            placeholder="Search views and saved work"
          />
          <nav aria-label="Search results">
            {matches.map((view) => (
              <a href={workspacePath(company.id, view)} key={view}>
                {labels[view]}
                <Icon name="arrow" />
              </a>
            ))}
          </nav>
          {active && saved.isError && (
            <p role="status">Saved work search is unavailable.</p>
          )}
          {active && saved.data && saved.data.items.length > 0 && (
            <nav aria-label="Saved work">
              {saved.data.items.map((item) => (
                <a href={artifactLink(item.businessId, item)} key={item.id}>
                  <span>
                    {item.title}
                    <small>
                      {item.businessName} · {item.kind}
                    </small>
                  </span>
                  <Icon name="arrow" />
                </a>
              ))}
            </nav>
          )}
          {!matches.length &&
            (query.length < 2 ||
              (active && saved.data?.items.length === 0)) && (
              <p role="status">No matching results.</p>
            )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function View({
  view,
  company,
  timezone,
}: {
  view: Exclude<WorkspaceView, 'home' | 'research' | 'growth' | 'settings'>;
  company: Company;
  timezone: string;
}) {
  const kind = view === 'build' ? 'website' : view === 'run' ? 'review' : view;
  return (
    <section className={styles.view} data-view={view}>
      {view !== 'schedule' && <h1>{labels[view]}</h1>}
      {view === 'build' ? (
        <div className={styles.buildGrid}>
          <PipChat
            key={company.id}
            id={company.id}
            readOnly={company.role === 'viewer'}
          />
          <WorkList id={company.id} role={company.role} kind={kind} />
        </div>
      ) : view === 'run' ? (
        <>
          <Runs company={company} />
          <div id="review-work">
            <WorkList id={company.id} role={company.role} kind="review" />
          </div>
        </>
      ) : (
        <>
          {view === 'inbox' && (
            <ReceivedMail
              key={company.id}
              id={company.id}
              timezone={timezone}
              editable={company.role !== 'viewer'}
            />
          )}
          {kind === 'library' && <WorkspaceFiles companyId={company.id} />}
          <WorkList
            id={company.id}
            role={company.role}
            kind={kind}
            timezone={timezone}
          />
        </>
      )}
    </section>
  );
}

export function Workbench({
  company,
  session,
  view,
}: {
  company: Company;
  session: Session;
  view: WorkspaceView;
}) {
  const [search, setSearch] = useState(false);
  const work = useWorkspaceSummary(company.id);
  const timezone = session.profile.timezone ?? session.profile.browserTimezone;
  usePreferences(session.profile);
  usePresence();
  useEffect(() => {
    void write(`/api/companies/${company.id}/opened`).catch(() => {
      /* The session still has the accessible workspace list. */
    });
  }, [company.id]);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearch((open) => !open);
      }
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, []);

  return (
    <main className={styles.shell}>
      <Sky
        plain={session.profile.background === 'plain'}
        reduceEffects={session.profile.reduceEffects}
      />
      <header className={styles.topbar}>
        <FloatingPanel
          label="Your businesses"
          width={310}
          trigger={
            <button className={styles.companyButton}>
              <span className={styles.companyBadge}>
                {company.name[0]?.toUpperCase()}
              </span>
              {company.name}
              <Icon name="chevron" />
            </button>
          }
        >
          <h3 className={styles.popoverTitle}>Your businesses</h3>
          <div className={styles.switcher}>
            {session.companyList.companies.map((entry) => (
              <a
                key={entry.id}
                href={workspacePath(entry.id)}
                aria-current={entry.id === company.id ? 'page' : undefined}
              >
                {entry.name}
                {entry.id === company.id && <Icon name="check" />}
              </a>
            ))}
          </div>
          <Button asChild variant="secondary" size="small">
            <a href="/new">New business</a>
          </Button>
          <Button asChild variant="quiet" size="small">
            <a href="/home?invitations=1">Workspace invitations</a>
          </Button>
        </FloatingPanel>
        <nav className={styles.mainNav} aria-label="Main">
          <a
            href={workspacePath(company.id)}
            aria-current={view === 'home' ? 'page' : undefined}
          >
            <Icon name="home" size={19} />
            Home
          </a>
          <a
            href={workspacePath(company.id, 'build')}
            aria-current={view === 'build' ? 'page' : undefined}
          >
            <Icon name="box" size={19} />
            Build
          </a>
        </nav>
        <nav className={styles.headerActions} aria-label="Workspace shortcuts">
          <Button
            size="icon"
            variant="quiet"
            aria-label="Search"
            onClick={() => setSearch(true)}
          >
            <Icon name="search" size={20} />
          </Button>
          <Button asChild size="icon" variant="quiet">
            <a href={workspacePath(company.id, 'inbox')} aria-label="Inbox">
              <Icon name="mail" size={20} />
            </a>
          </Button>
          <Button asChild size="icon" variant="quiet">
            <a
              href={workspacePath(company.id, 'schedule')}
              aria-label="Schedule"
            >
              <Icon name="calendar" size={20} />
            </a>
          </Button>
          <Notifications
            companyId={company.id}
            showBadge={session.profile.showNotificationBadges !== false}
          />
        </nav>
        <Profile session={session} />
      </header>
      {view === 'home' ? (
        <Home
          company={company}
          timezone={timezone}
          onSearch={() => setSearch(true)}
          items={work.data?.items}
          unavailable={work.isError}
        />
      ) : view === 'research' ? (
        <WebSearch
          key={`${session.userId}:${company.id}`}
          accountId={session.userId}
          company={company}
        />
      ) : view === 'growth' ? (
        <Growth key={company.id} company={company} />
      ) : view === 'settings' ? (
        <WorkspaceSettings
          key={company.id}
          company={company}
          accountId={session.userId}
        />
      ) : (
        <View company={company} view={view} timezone={timezone} />
      )}
      {view !== 'build' && (
        <Button asChild className={styles.floatingMessage}>
          <a href={workspacePath(company.id, 'build')}>
            <Mascot size={29} />
            Message {brand.agent}
          </a>
        </Button>
      )}
      <Search company={company} open={search} setOpen={setSearch} />
    </main>
  );
}
