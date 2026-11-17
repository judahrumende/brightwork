import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { api, errorMessage, write } from '../auth/client';
import type { Company } from '../auth/client';
import { Mascot } from '../ui/icons';
import { Button, Pill } from '../ui/primitives';
import { workspacePath } from './session';
import styles from './runs.module.css';

type Run = {
  id: string;
  goal: string;
  state: 'active' | 'paused' | 'completed' | 'failed';
  waitingFor: 'answer' | 'approval' | null;
  creditLimit: string;
  creditsUsed: string;
  failure: string | null;
  createdAt: string;
  endedAt: string | null;
  publications: {
    id: string;
    artifactId: string;
    revision: number;
    title: string;
    state: 'queued' | 'published' | 'failed';
    failure: string | null;
  }[];
  steps: {
    position: number;
    instruction: string;
    attempt: number;
    turnId: string | null;
    finishedAt: string | null;
    status: 'queued' | 'running' | 'completed' | 'failed' | null;
    answer: string | null;
  }[];
};

const starterSteps = [
  'Write a concise business plan and save it as a document.',
  'Build a first homepage draft from the plan and business details.',
  'Save one dated follow-up task for the business.',
].join('\n');

export function runStatus(run: Run) {
  if (run.state === 'active') {
    if (run.waitingFor === 'answer') return 'Waiting for your answer';
    if (run.waitingFor === 'approval') return 'Waiting for approval';
    return 'Active';
  }
  return { paused: 'Paused', completed: 'Completed', failed: 'Stopped' }[
    run.state
  ];
}

function displayCredits(amount: string) {
  return amount.replace(/(\.\d*?[1-9])0+$/u, '$1').replace(/\.0+$/u, '');
}

const runsKey = (companyId: string) => ['company', companyId, 'runs'];
const runsPath = (companyId: string) =>
  '/api/companies/' + encodeURIComponent(companyId) + '/pip/runs';

export function useRuns(companyId: string) {
  return useQuery({
    queryKey: runsKey(companyId),
    queryFn: ({ signal }) =>
      api<{ enabled: boolean; canPublish: boolean; runs: Run[] }>(
        runsPath(companyId),
        { signal },
      ),
    refetchInterval: (query) =>
      query.state.data?.runs.some((run) => run.state === 'active')
        ? 3_000
        : 15_000,
  });
}

export function Runs({ company }: { company: Company }) {
  const cache = useQueryClient();
  const queryKey = runsKey(company.id);
  const endpoint = runsPath(company.id);
  const runs = useRuns(company.id);
  const mayControl = company.role === 'admin' || company.role === 'owner';
  const current = runs.data?.runs.find(
    (run) => run.state === 'active' || run.state === 'paused',
  );
  const history =
    runs.data?.runs.filter(
      (run) => run.state === 'completed' || run.state === 'failed',
    ) ?? [];
  const [goal, setGoal] = useState('');
  const [steps, setSteps] = useState(starterSteps);
  const [planWithPip, setPlanWithPip] = useState(true);
  const [creditLimit, setCreditLimit] = useState('2');
  const [publishWebsites, setPublishWebsites] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function start(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await write(endpoint, {
        goal,
        steps: planWithPip
          ? []
          : steps
              .split('\n')
              .map((step) => step.trim())
              .filter(Boolean),
        creditLimit,
        publishWebsites: Boolean(runs.data?.canPublish && publishWebsites),
      });
      setGoal('');
      await cache.invalidateQueries({ queryKey });
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function control(run: Run) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await write(endpoint + '/' + run.id + '/control', {
        action: run.state === 'paused' ? 'resume' : 'pause',
      });
      await cache.invalidateQueries({ queryKey });
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.panel} aria-label="Business Runs">
      {runs.isPending && <p role="status">Loading Runs…</p>}
      {runs.isError && (
        <div role="alert">
          <p>{errorMessage(runs.error)}</p>
          <Button variant="secondary" onClick={() => void runs.refetch()}>
            Try again
          </Button>
        </div>
      )}
      {current && (
        <>
          <header className={styles.header}>
            <Mascot size={35} />
            <h2>Current Run</h2>
            <Pill
              tone={
                current.state === 'paused' || current.waitingFor
                  ? 'warning'
                  : 'good'
              }
            >
              {runStatus(current)}
            </Pill>
            {mayControl && (
              <Button
                size="small"
                variant="secondary"
                disabled={busy}
                onClick={() => void control(current)}
              >
                {current.state === 'paused' ? 'Resume' : 'Pause'}
              </Button>
            )}
          </header>
          <RunSummary run={current} companyId={company.id} />
          {current.waitingFor === 'answer' && (
            <Button asChild size="small" variant="secondary">
              <a href={workspacePath(company.id, 'inbox')}>Open questions</a>
            </Button>
          )}
          {current.waitingFor === 'approval' && (
            <Button asChild size="small" variant="secondary">
              <a href="#review-work">Review drafts</a>
            </Button>
          )}
        </>
      )}
      {runs.data &&
        !current &&
        (mayControl && runs.data.enabled ? (
          <form className={styles.form} onSubmit={(event) => void start(event)}>
            <h2>Start a Run</h2>
            <label>
              Goal
              <input
                required
                value={goal}
                maxLength={4000}
                onChange={(event) => setGoal(event.currentTarget.value)}
              />
            </label>
            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={planWithPip}
                onChange={(event) =>
                  setPlanWithPip(event.currentTarget.checked)
                }
              />
              Let Pip plan the steps
            </label>
            {!planWithPip && (
              <label>
                Steps (one per line, up to 12)
                <textarea
                  required
                  rows={4}
                  value={steps}
                  onChange={(event) => setSteps(event.currentTarget.value)}
                />
              </label>
            )}
            <label>
              Run credit limit
              <input
                required
                inputMode="decimal"
                pattern={String.raw`[0-9]{1,14}(\.[0-9]{1,10})?`}
                value={creditLimit}
                onChange={(event) => setCreditLimit(event.currentTarget.value)}
              />
            </label>
            {runs.data.canPublish && (
              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={publishWebsites}
                  onChange={(event) =>
                    setPublishWebsites(event.currentTarget.checked)
                  }
                />
                Queue website publication when I approve the draft
              </label>
            )}
            <Button type="submit" disabled={busy}>
              {busy ? 'Starting…' : 'Start Run'}
            </Button>
          </form>
        ) : (
          <p>
            {mayControl
              ? 'Configure an LLM provider to start a Run.'
              : 'An owner or admin can start a Run.'}
          </p>
        ))}
      {error && <p role="alert">{error}</p>}
      {history.length > 0 && (
        <section className={styles.history}>
          <h2>Earlier Runs</h2>
          {history.map((run) => (
            <details key={run.id}>
              <summary>
                {run.goal} · {runStatus(run)}
              </summary>
              <RunSummary run={run} companyId={company.id} />
            </details>
          ))}
        </section>
      )}
    </section>
  );
}

export function RunSummary({
  run,
  companyId,
}: {
  run: Run;
  companyId: string;
}) {
  return (
    <div className={styles.summary}>
      <p>{run.goal}</p>
      <p className={styles.subtle}>
        {run.steps.filter((step) => step.finishedAt).length} of{' '}
        {run.steps.length} steps finished
        {' · '}
        {displayCredits(run.creditsUsed)} / {displayCredits(run.creditLimit)}{' '}
        credits
      </p>
      <ol className={styles.steps}>
        {run.steps.map((step) => (
          <li key={step.position}>
            <span>{step.instruction}</span>
            <small>
              {step.finishedAt
                ? 'Finished'
                : {
                    queued: 'Queued',
                    running: 'Working',
                    completed: 'Ready to continue',
                    failed: 'Stopped',
                  }[step.status ?? 'queued']}
            </small>
            {step.answer && (
              <details>
                <summary>Step result</summary>
                <p>{step.answer}</p>
              </details>
            )}
          </li>
        ))}
      </ol>
      {run.publications.length > 0 && (
        <section aria-label="Website publication history">
          <h3>Website publications</h3>
          <ul>
            {run.publications.map((publication) => (
              <li key={publication.id}>
                <a
                  href={
                    workspacePath(companyId, 'build') +
                    '?item=' +
                    publication.artifactId
                  }
                >
                  {publication.title}
                </a>
                {' · '}
                Revision {publication.revision} · {publication.state}
                {publication.failure && <p>{publication.failure}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {run.failure && <p>{run.failure}</p>}
      <RunHistory run={run} companyId={companyId} />
    </div>
  );
}

type RunHistoryPage = {
  before: number | null;
  events: { id: number; kind: string; detail: string; createdAt: string }[];
};

const eventLabels: Record<string, string> = {
  started: 'Run started',
  planned: 'Step added',
  paused: 'Run paused',
  resumed: 'Run resumed',
  waiting: 'Waiting for owner',
  unblocked: 'Run continued',
  step_queued: 'Step queued',
  step_finished: 'Step completed',
  completed: 'Run completed',
  failed: 'Run stopped',
};

function RunHistory({ run, companyId }: { run: Run; companyId: string }) {
  const [open, setOpen] = useState(false);
  const history = useInfiniteQuery({
    queryKey: [...runsKey(companyId), run.id, 'history'],
    enabled: open,
    initialPageParam: 0,
    getNextPageParam: (last: RunHistoryPage) => last.before ?? undefined,
    queryFn: ({ pageParam, signal }) =>
      api<RunHistoryPage>(
        runsPath(companyId) +
          '/' +
          run.id +
          '/history' +
          (pageParam ? '?before=' + pageParam : ''),
        { signal },
      ),
    refetchInterval: open && run.state === 'active' ? 3_000 : false,
  });
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Run history</summary>
      {open && history.isPending && <p role="status">Loading Run history…</p>}
      {open && history.isError && (
        <p role="alert">{errorMessage(history.error)}</p>
      )}
      <ul>
        {history.data?.pages.flatMap((page) =>
          page.events.map((event) => (
            <li key={event.id}>
              <time dateTime={event.createdAt}>
                {new Date(event.createdAt).toLocaleString()}
              </time>
              {' · '}
              {eventLabels[event.kind] ?? event.kind}
              {event.detail && ' · ' + event.detail}
            </li>
          )),
        )}
      </ul>
      {history.hasNextPage && (
        <Button
          size="small"
          variant="secondary"
          disabled={history.isFetchingNextPage}
          onClick={() => void history.fetchNextPage()}
        >
          Load earlier events
        </Button>
      )}
    </details>
  );
}
