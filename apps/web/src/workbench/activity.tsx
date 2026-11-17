import { useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { brand, workNotificationKey } from '@brightwork/shared';
import { api, errorMessage, write } from '../auth/client';
import { Icon, Mascot } from '../ui/icons';
import { FloatingPanel, Modal } from '../ui/overlays';
import { Button, EmptyState, Segmented } from '../ui/primitives';
import { artifactLink, inProgress, usePipTurns } from './agent';
import type { WorkSummary } from './agent';
import { workspacePath } from './session';
import { RunSummary, runStatus, useRuns } from './runs';
import styles from './workbench.module.css';

const noItems: WorkSummary[] = [];
const needsAttention = (item: WorkSummary) =>
  workNotificationKey(item) !== null;
const action = (item: Pick<WorkSummary, 'kind'>) =>
  item.kind === 'question' ? 'Question from Pip' : 'Review requested';
const turnStatus = {
  queued: 'Queued',
  running: 'Working',
  completed: 'Complete',
  failed: 'Stopped',
};

function WorkLinks({
  items,
  companyId,
  actionable = false,
}: {
  items: readonly WorkSummary[];
  companyId: string;
  actionable?: boolean;
}) {
  return (
    <ul className={styles.activityLinks}>
      {items.map((item) => (
        <li key={item.id}>
          <a
            href={artifactLink(
              companyId,
              item,
              actionable && item.state === 'pending' && item.inRun,
            )}
          >
            <span>
              <strong>{item.title}</strong>
              <small>{actionable ? action(item) : item.kind}</small>
            </span>
            <Icon name="arrow" />
          </a>
        </li>
      ))}
    </ul>
  );
}

export function PipActivity({
  companyId,
  items,
}: {
  companyId: string;
  items: readonly WorkSummary[] | undefined;
}) {
  const chat = usePipTurns(companyId, true);
  const runs = useRuns(companyId);
  const current = runs.data?.runs.find(
    (run) => run.state === 'active' || run.state === 'paused',
  );
  const [tab, setTab] = useState('activity');
  const turns = chat.data?.turns;
  const working = turns?.some(inProgress);
  const attention = items?.filter(needsAttention) ?? noItems;
  const made =
    items?.filter((item) => item.kind !== 'question' && item.kind !== 'task') ??
    noItems;
  const recent = turns?.slice(-5).reverse() ?? [];
  const display = working
    ? 'Working on your request.'
    : attention.length
      ? 'Waiting for your input.'
      : current
        ? runStatus(current)
        : turns
          ? 'Ready to get to work.'
          : 'Pip activity';
  return (
    <aside className={styles.statusRail} aria-label={`${brand.agent} activity`}>
      <div className={styles.statusCard}>
        <div className={styles.statusHeading}>
          <Mascot size={56} />
          <h2 aria-live="polite">{display}</h2>
        </div>
        <a className={styles.railLink} href={workspacePath(companyId, 'build')}>
          Message {brand.agent} <Icon name="arrow" />
        </a>
      </div>
      {attention.length > 0 && (
        <div className={styles.statusCard}>
          <h3 className={styles.popoverTitle}>Needs your input</h3>
          <WorkLinks
            items={attention.slice(0, 3)}
            companyId={companyId}
            actionable
          />
        </div>
      )}
      <Segmented
        label="Pip activity"
        options={[
          { value: 'activity', label: 'Activity' },
          { value: 'made', label: 'Made' },
          { value: 'runs', label: 'Runs' },
        ]}
        value={tab}
        onValueChange={setTab}
      />
      <div className={styles.statusCard}>
        {tab === 'activity' &&
          (chat.isPending ? (
            <p role="status">Loading activity…</p>
          ) : chat.isError ? (
            <p role="status">Activity is unavailable.</p>
          ) : recent.length ? (
            <ul className={styles.activityLinks}>
              {recent.map((turn) => (
                <li key={turn.id}>
                  <a href={workspacePath(companyId, 'build')}>
                    <span>
                      <strong>{turn.prompt}</strong>
                      <small>{turnStatus[turn.status]}</small>
                    </span>
                    <Icon name="arrow" />
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No activity yet" />
          ))}
        {tab === 'made' &&
          (made.length ? (
            <WorkLinks items={made.slice(0, 5)} companyId={companyId} />
          ) : (
            <EmptyState
              title={items ? 'Nothing made yet' : 'Work is unavailable'}
            />
          ))}
        {tab === 'runs' && (
          <div className={styles.runShortcuts}>
            {runs.data?.runs.slice(0, 4).map((run) => (
              <Modal
                key={run.id}
                title="Run summary"
                description={runStatus(run)}
                trigger={
                  <Button size="small" variant="secondary">
                    {run.goal}
                  </Button>
                }
              >
                <RunSummary run={run} companyId={companyId} />
                <Button asChild size="small" variant="secondary">
                  <a href={workspacePath(companyId, 'run')}>
                    Open Run controls
                  </a>
                </Button>
              </Modal>
            ))}
            <Button asChild size="small" variant="secondary">
              <a href={workspacePath(companyId, 'run')}>Open Run</a>
            </Button>
          </div>
        )}
      </div>
    </aside>
  );
}

type NotificationPage = {
  items: (Pick<WorkSummary, 'kind' | 'title'> & {
    id: number;
    artifactId: string;
    createdAt: string;
    resolvedAt: string | null;
    readAt: string | null;
  })[];
  unread: number;
  before: number | null;
};

export function Notifications({ companyId }: { companyId: string }) {
  const cache = useQueryClient();
  const [filter, setFilter] = useState('all');
  const [marking, setMarking] = useState(false);
  const [error, setError] = useState('');
  const root = '/api/companies/' + encodeURIComponent(companyId);
  const queryKey = ['company', companyId, 'notifications'] as const;
  const history = useInfiniteQuery({
    queryKey,
    initialPageParam: null as number | null,
    getNextPageParam: (last: NotificationPage) => last.before ?? undefined,
    queryFn: ({ signal, pageParam }) =>
      api<NotificationPage>(
        root +
          '/notifications' +
          (pageParam === null ? '' : '?before=' + pageParam),
        { signal },
      ),
    refetchInterval: 15_000,
  });
  const items = history.data?.pages.flatMap((page) => page.items) ?? [];
  const badge = history.data?.pages[0]?.unread ?? 0;
  const visible =
    filter === 'unread'
      ? items.filter((item) => !item.readAt && !item.resolvedAt)
      : items;
  const label = badge ? `Notifications, ${badge} unread` : 'Notifications';

  async function markAllRead() {
    if (marking || !badge) return;
    setMarking(true);
    setError('');
    try {
      await write(root + '/run/read', { all: true });
      await cache.invalidateQueries({ queryKey });
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setMarking(false);
    }
  }

  return (
    <FloatingPanel
      label="Notifications"
      trigger={
        <Button
          size="icon"
          variant="quiet"
          aria-label={label}
          className={styles.notificationButton}
        >
          <Icon name="bell" size={20} />
          {badge > 0 && (
            <span className={styles.notificationBadge} aria-hidden="true">
              {badge > 9 ? '9+' : badge}
            </span>
          )}
        </Button>
      }
    >
      <h3 className={styles.popoverTitle}>Notifications</h3>
      {items.length > 0 && (
        <div className={styles.notificationControls}>
          <Segmented
            label="Filter notifications"
            options={[
              { value: 'all', label: 'All' },
              { value: 'unread', label: 'Unread' },
            ]}
            value={filter}
            onValueChange={setFilter}
          />
          <Button
            size="small"
            variant="quiet"
            disabled={marking || !badge}
            onClick={() => void markAllRead()}
          >
            Mark all read
          </Button>
        </div>
      )}
      {visible.length > 0 ? (
        <ul className={styles.activityLinks}>
          {visible.map((item) => (
            <li key={item.id}>
              <a
                href={artifactLink(companyId, {
                  id: item.artifactId,
                  kind: item.kind,
                })}
              >
                <span>
                  <strong>{item.title}</strong>
                  <small>
                    {action(item)} ·{' '}
                    {item.resolvedAt
                      ? 'Resolved'
                      : item.readAt
                        ? 'Read'
                        : 'Unread'}
                  </small>
                  <small>
                    <time dateTime={item.createdAt}>
                      {new Date(item.createdAt).toLocaleDateString()}
                    </time>
                  </small>
                </span>
                <Icon name="arrow" />
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title={
            history.isError
              ? 'Notifications are unavailable'
              : history.isPending
                ? 'Loading notifications…'
                : filter === 'unread'
                  ? 'No unread notifications on this page'
                  : 'You’re up to date'
          }
        />
      )}
      {history.hasNextPage && (
        <Button
          size="small"
          variant="secondary"
          disabled={history.isFetching}
          onClick={() => void history.fetchNextPage()}
        >
          Load earlier notifications
        </Button>
      )}
      {(error || history.isFetchNextPageError) && (
        <p className={styles.alert} role="alert">
          {error || 'Earlier notifications are unavailable.'}
        </p>
      )}
    </FloatingPanel>
  );
}
