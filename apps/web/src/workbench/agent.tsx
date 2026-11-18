import * as Dialog from '@radix-ui/react-dialog';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { brand } from '@brightwork/shared';
import { api, errorMessage, write } from '../auth/client';
import { Button, EmptyState, Pill, Segmented } from '../ui/primitives';
import { Icon, Mascot } from '../ui/icons';
import { applyTurnChanges, readTurnSnapshot } from './turn-events';
import type { Turn } from './turn-events';
import { creditKey, workspacePath } from './session';
import { TaskCalendar } from './task-calendar';
import { CalendarEventFields } from './calendar-event';
import { WebsiteReview } from './website-review';
import { WebsitePreview } from './website-preview';
import { WebsiteVersions } from './website-versions';
import { WebsiteEditor } from './website-editor';
import { WebsiteDeployments } from './website-deployments';
import { WebsiteImport } from './website-import';
import { BuildCanvas } from './build-canvas';
import type { WebsiteDraft } from './website-editor';
import type { WebsitePage } from '@brightwork/shared';
import { ChatTurn } from './chat-turn';
import { ChatHistory } from './chat-history';
import { Dictation } from './dictation';
import { EmailDeliveryHistory } from './email-delivery-history';
import styles from './workbench.module.css';

type Chat = { enabled: boolean; turns: Turn[]; before?: string | null };
type Artifact = {
  id: string;
  kind:
    'document' | 'email' | 'post' | 'website' | 'question' | 'task' | 'memory';
  title: string;
  body: string;
  pages?: WebsitePage[];
  state: 'draft' | 'pending' | 'approved' | 'rejected';
  dueAt: string | null;
  recurrence: 'once' | 'daily' | 'weekly' | 'monthly';
  scheduleTimezone: string;
  upcoming: string[];
  publicUrl: string | null;
  answer: string | null;
  revision: number;
  liveDraftRevision: number | null;
  publishWithRun?: boolean | null;
  automatic?: boolean | null;
  emailTriggered?: boolean;
  nextAutomationAt?: string | null;
  latestAutomationTurnId?: string | null;
  emailState?:
    'queued' | 'sending' | 'accepted' | 'failed' | 'needs_review' | null;
  emailRecipient?: string | null;
  replyRecipient?: string | null;
  emailNote?: string | null;
};
const turnKey = (id: string) => ['company', id, 'turns'] as const;
const workKey = (id: string) => ['company', id, 'work'] as const;
const root = (id: string) => '/api/companies/' + encodeURIComponent(id);
export const inProgress = (turn: Turn) =>
  turn.status === 'queued' || turn.status === 'running';

export function usePipTurns(id: string, background = false) {
  return useQuery({
    queryKey: turnKey(id),
    queryFn: ({ signal }) => api<Chat>(root(id) + '/pip/turns', { signal }),
    refetchInterval: (query) =>
      query.state.data?.turns.some(inProgress)
        ? 4000
        : background
          ? 15000
          : false,
  });
}

export type WorkSummary = Pick<
  Artifact,
  'id' | 'kind' | 'title' | 'state' | 'revision'
> & {
  answered: boolean;
  inRun?: boolean;
};

export function useWorkspaceSummary(id: string) {
  return useQuery({
    queryKey: [...workKey(id), 'summary'],
    queryFn: ({ signal }) =>
      api<{ items: WorkSummary[] }>(root(id) + '/work/summary', { signal }),
    refetchInterval: 15000,
  });
}

export function artifactLink(
  companyId: string,
  item: Pick<WorkSummary, 'id' | 'kind'>,
  review = false,
) {
  const view = review
    ? 'run'
    : {
        website: 'build',
        email: 'inbox',
        post: 'inbox',
        question: 'inbox',
        document: 'library',
        memory: 'library',
        task: 'schedule',
      }[item.kind];
  return (
    workspacePath(companyId, view) +
    '?' +
    new URLSearchParams({ item: item.id })
  );
}

export function PipChat({ id, readOnly }: { id: string; readOnly: boolean }) {
  const cache = useQueryClient();
  const chat = usePipTurns(id);
  const [prompt, setPrompt] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [earlier, setEarlier] = useState<Chat | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const before = earlier ? earlier.before : chat.data?.before;
  const current = chat.data?.turns ?? [];
  const known = new Set(current.map((turn) => turn.id));
  const transcript = [
    ...(earlier?.turns ?? []).filter((turn) => !known.has(turn.id)),
    ...current,
  ];
  const active = (
    chat.data?.turns.filter(inProgress).map((turn) => turn.id) ?? []
  ).join(',');
  const enabled = Boolean(chat.data?.enabled && !readOnly);
  useEffect(() => {
    if (!active) return;
    const sources = active.split(',').map((turnId) => {
      const events = new EventSource(
        root(id) + '/pip/turns/' + turnId + '/events',
      );
      function save(next: Turn) {
        cache.setQueryData<Chat>(turnKey(id), (existing) => {
          if (!existing) return existing;
          return {
            ...existing,
            turns: existing.turns.map((turn) =>
              turn.id === next.id && turn.revision <= next.revision
                ? { ...turn, ...next }
                : turn,
            ),
          };
        });
        if (!inProgress(next)) {
          events.close();
          void cache.invalidateQueries({ queryKey: workKey(id) });
          void cache.invalidateQueries({ queryKey: creditKey });
        }
      }
      events.addEventListener('turn', (event: MessageEvent<string>) => {
        try {
          const turn = readTurnSnapshot(JSON.parse(event.data), turnId);
          if (turn) save(turn);
        } catch {
          /* Polling resumes from persisted state. */
        }
      });
      events.addEventListener('changes', (event: MessageEvent<string>) => {
        try {
          const previous = cache
            .getQueryData<Chat>(turnKey(id))
            ?.turns.find((turn) => turn.id === turnId);
          if (!previous) return;
          const next = applyTurnChanges(previous, JSON.parse(event.data));
          if (next) save(next);
        } catch {
          /* Polling resumes from persisted state. */
        }
      });
      return events;
    });
    return () => sources.forEach((source) => source.close());
  }, [active, cache, id]);

  async function loadEarlier() {
    if (!before || loadingHistory) return;
    setLoadingHistory(true);
    setHistoryError('');
    try {
      const page = await api<Chat>(
        root(id) + '/pip/turns?' + new URLSearchParams({ before }),
      );
      setEarlier((previous) => ({
        ...page,
        turns: [...page.turns, ...(previous?.turns ?? current)],
      }));
    } catch (failure) {
      setHistoryError(errorMessage(failure));
    } finally {
      setLoadingHistory(false);
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (pending || !enabled || !prompt.trim()) return;
    setPending(true);
    setError('');
    try {
      const attachments = await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          content: await file.text(),
        })),
      );
      const turn = await write<Turn>(root(id) + '/pip/turns', {
        prompt,
        ...(attachments.length ? { attachments } : {}),
      });
      cache.setQueryData<Chat>(
        turnKey(id),
        (existing) =>
          existing && {
            ...existing,
            turns: existing.turns.some((entry) => entry.id === turn.id)
              ? existing.turns
              : [...existing.turns, turn],
          },
      );
      setPrompt('');
      setFiles([]);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className={styles.chat} aria-label={`Chat with ${brand.agent}`}>
      <header>
        <Mascot size={32} />
        <h2>Talk to {brand.agent}</h2>
        <ChatHistory key={id} companyId={id} />
      </header>
      <div className={styles.transcript}>
        {before && (
          <Button
            type="button"
            size="small"
            variant="secondary"
            disabled={loadingHistory}
            onClick={() => void loadEarlier()}
          >
            Load earlier messages
          </Button>
        )}
        {historyError && <p role="alert">{historyError}</p>}
        {transcript.length === 0 && (
          <EmptyState
            icon={<Mascot size={56} />}
            title="What would you like to work on?"
            description="Ask for a plan, a page, or a draft to review."
          />
        )}
        {transcript.map((turn) => (
          <ChatTurn key={turn.id} turn={turn} companyId={id} />
        ))}
      </div>
      <form
        onSubmit={(event) => {
          void send(event);
        }}
      >
        {chat.isError && (
          <p role="alert">
            {errorMessage(chat.error)}{' '}
            <button
              type="button"
              onClick={() => {
                void chat.refetch();
              }}
            >
              Retry
            </button>
          </p>
        )}
        {readOnly ? (
          <p role="status">This workspace is view only.</p>
        ) : (
          chat.data &&
          !enabled && (
            <p role="status">
              Connect an LLM provider to message {brand.agent}.
            </p>
          )
        )}
        <label htmlFor="pip-prompt">Message {brand.agent}</label>
        <textarea
          id="pip-prompt"
          value={prompt}
          maxLength={12000}
          disabled={!enabled}
          rows={3}
          onChange={(event) => setPrompt(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <label>
          Attach text files
          <input
            type="file"
            multiple
            accept=".txt,.md,.csv,.json,.log"
            disabled={!enabled || pending}
            onChange={(event) => {
              const input = event.currentTarget;
              const picked = Array.from(input.files ?? []);
              input.value = '';
              if (
                picked.length > 3 ||
                picked.some((file) => file.size < 1 || file.size > 24 * 1024)
              ) {
                setError('Choose up to three text files, each up to 24 KB.');
                return;
              }
              setError('');
              setFiles(picked);
            }}
          />
        </label>
        {files.length > 0 && (
          <p>
            {files.map((file) => file.name).join(', ')}{' '}
            <Button
              type="button"
              size="small"
              variant="quiet"
              onClick={() => setFiles([])}
              disabled={pending}
            >
              Remove attachments
            </Button>
          </p>
        )}
        <Dictation
          disabled={!enabled || pending}
          onTranscript={(text) =>
            setPrompt((draft) =>
              [draft.trimEnd(), text].filter(Boolean).join(' ').slice(0, 12000),
            )
          }
        />
        <Button type="submit" disabled={!enabled || pending || !prompt.trim()}>
          {pending ? 'Sending…' : 'Send'}
        </Button>
        {error && <p role="alert">{error}</p>}
      </form>
    </section>
  );
}

export function WorkList({
  id,
  kind,
  role,
  timezone = 'UTC',
}: {
  id: string;
  kind: 'website' | 'library' | 'inbox' | 'schedule' | 'review';
  role: string;
  timezone?: string;
}) {
  const cache = useQueryClient();
  const work = useQuery({
    queryKey: workKey(id),
    queryFn: () =>
      api<{
        items: Artifact[];
        hosting: boolean;
        outreachSender?: string | null;
      }>(root(id) + '/work'),
    refetchInterval: 15000,
  });
  const [open, setOpen] = useState(() =>
    new URLSearchParams(window.location.search).get('item'),
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [scheduleItem, setScheduleItem] = useState<'task' | 'event' | 'inbox'>(
    'task',
  );
  const scheduleForm = useId();
  const createOrigin = useRef<Element | null>(null);
  const [listTasks, setListTasks] = useState(false);
  const [response, setResponse] = useState('');
  const [recipient, setRecipient] = useState('');
  const [showVersions, setShowVersions] = useState(false);
  const [editing, setEditing] = useState<WebsiteDraft | null>(null);
  const recent = work.data?.items.find((item) => item.id === open);
  const older = useQuery({
    queryKey: [...workKey(id), 'item', open],
    enabled: Boolean(open) && !recent && !work.isPending,
    refetchInterval: 15000,
    queryFn: ({ signal }) =>
      api<{ item: Artifact; outreachSender?: string | null }>(
        root(id) + '/work/' + encodeURIComponent(open ?? ''),
        { signal },
      ),
  });
  const selected = recent ?? older.data?.item;
  const outreachSender =
    work.data?.outreachSender ?? older.data?.outreachSender;
  const showCalendar = kind === 'schedule' && !listTasks;
  const items =
    work.data?.items.filter((item) => {
      if (kind === 'website') return item.kind === 'website';
      if (kind === 'inbox')
        return ['email', 'post', 'question'].includes(item.kind);
      if (kind === 'schedule') return item.kind === 'task';
      if (kind === 'review') return item.state === 'pending';
      return ['document', 'memory', 'website'].includes(item.kind);
    }) ?? [];

  function openTaskForm() {
    createOrigin.current = document.activeElement;
    setError('');
    setScheduleItem('task');
    setCreating(true);
  }

  async function review(item: Artifact, approve: boolean) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await write(root(id) + '/work/' + item.id + '/decision', {
        approve,
        revision: item.revision,
      });
      await cache.invalidateQueries({ queryKey: workKey(id) });
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  async function publication(item: Artifact, publish: boolean) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await write(root(id) + '/work/' + item.id + '/publish', {
        publish,
        revision: item.revision,
      });
      await cache.invalidateQueries({ queryKey: workKey(id) });
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function answer(event: FormEvent<HTMLFormElement>, item: Artifact) {
    event.preventDefault();
    if (busy || !response.trim()) return;
    setBusy(true);
    setError('');
    try {
      await write(root(id) + '/work/' + item.id + '/answer', {
        answer: response,
      });
      await cache.invalidateQueries({ queryKey: workKey(id) });
      setResponse('');
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>, item: Artifact) {
    event.preventDefault();
    if (!editing || busy) return;
    setBusy(true);
    setError('');
    try {
      await write(root(id) + '/work/' + item.id + '/website', editing, 'PATCH');
      await cache.invalidateQueries({ queryKey: workKey(id) });
      setEditing(null);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function createScheduleItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const data = new FormData(event.currentTarget);
    try {
      if (scheduleItem === 'event') {
        await write(root(id) + '/schedule/events', {
          ...Object.fromEntries(data),
          timezone,
        });
      } else {
        await write(root(id) + '/work/tasks', {
          title: String(data.get('title')),
          body: String(data.get('body')),
          ...(scheduleItem === 'inbox'
            ? { whenEmailArrives: true }
            : {
                dueAt: new Date(String(data.get('dueAt'))).toISOString(),
                recurrence: String(data.get('recurrence')),
                scheduleTimezone:
                  Intl.DateTimeFormat().resolvedOptions().timeZone,
                automatic: data.get('automatic') === 'on',
              }),
        });
      }
      await cache.invalidateQueries({ queryKey: workKey(id) });
      if (scheduleItem === 'inbox') setListTasks(true);
      setCreating(false);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function controlSchedule(item: Artifact) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await write(
        root(id) + '/work/' + item.id + '/automation',
        { enabled: !item.automatic },
        'PATCH',
      );
      await cache.invalidateQueries({ queryKey: workKey(id) });
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function sendEmail(event: FormEvent<HTMLFormElement>, item: Artifact) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await write(root(id) + '/work/' + item.id + '/send-email', {
        recipient: item.replyRecipient ?? recipient,
        revision: item.revision,
      });
      await cache.invalidateQueries({ queryKey: workKey(id) });
      setRecipient('');
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.workList}>
      {kind === 'schedule' && listTasks && (
        <>
          <h1>All tasks</h1>
          <Button variant="secondary" onClick={() => setListTasks(false)}>
            Show calendar
          </Button>
        </>
      )}
      {kind === 'schedule' && listTasks && role !== 'viewer' && (
        <Button variant="secondary" onClick={openTaskForm}>
          New task
        </Button>
      )}
      {kind === 'schedule' && (
        <Dialog.Root
          open={creating}
          onOpenChange={(value) => {
            if (!busy) {
              setCreating(value);
              setError('');
            }
          }}
        >
          <Dialog.Portal>
            <Dialog.Overlay className={styles.scheduleScrim} />
            <Dialog.Content
              className={`${styles.taskDialog} ${styles.scheduleEditor}`}
              aria-describedby={undefined}
              onCloseAutoFocus={(event) => {
                const origin = createOrigin.current;
                if (origin instanceof HTMLElement) {
                  event.preventDefault();
                  origin.focus();
                }
              }}
            >
              <header>
                <Dialog.Close asChild>
                  <Button
                    size="icon"
                    variant="quiet"
                    disabled={busy}
                    aria-label="Close"
                  >
                    ×
                  </Button>
                </Dialog.Close>
                <Dialog.Title>
                  {scheduleItem === 'event' ? 'New event' : 'New task'}
                </Dialog.Title>
                <Button
                  type="submit"
                  form={scheduleForm}
                  variant="secondary"
                  size="icon"
                  disabled={busy}
                  aria-label={
                    scheduleItem === 'event' ? 'Save event' : 'Save task'
                  }
                >
                  <Icon name="check" />
                </Button>
              </header>
              <Segmented
                label="Schedule item"
                options={[
                  { value: 'task', label: 'Task', disabled: busy },
                  { value: 'event', label: 'Event', disabled: busy },
                  ...(['owner', 'admin'].includes(role)
                    ? [
                        {
                          value: 'inbox',
                          label: 'Inbox trigger',
                          disabled: busy,
                        },
                      ]
                    : []),
                ]}
                value={scheduleItem}
                onValueChange={(value) => {
                  if (
                    value !== 'event' &&
                    value !== 'inbox' &&
                    value !== 'task'
                  )
                    return;
                  setScheduleItem(value);
                  setError('');
                }}
              />
              <form
                id={scheduleForm}
                className={styles.taskForm}
                onSubmit={(event) => {
                  void createScheduleItem(event);
                }}
              >
                <input
                  required
                  name="title"
                  maxLength={160}
                  aria-label="Title"
                  placeholder="Title"
                />
                {scheduleItem === 'event' ? (
                  <CalendarEventFields timezone={timezone} />
                ) : scheduleItem === 'inbox' ? (
                  <>
                    <label>
                      Instructions for Pip
                      <textarea name="body" required maxLength={4000} />
                    </label>
                    <p>
                      Pip uses your credits when a new email reaches this
                      workspace.
                    </p>
                  </>
                ) : (
                  <>
                    <label>
                      Due at ({Intl.DateTimeFormat().resolvedOptions().timeZone}
                      )
                      <input required name="dueAt" type="datetime-local" />
                    </label>
                    <label>
                      Repeat
                      <select name="recurrence">
                        <option value="once">Does not repeat</option>
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                      </select>
                    </label>
                    <label>
                      Notes
                      <textarea name="body" maxLength={4000} />
                    </label>
                    {(role === 'owner' || role === 'admin') && (
                      <label className={styles.scheduleCheckbox}>
                        <input type="checkbox" name="automatic" />
                        Run this task with Pip at its scheduled time using my
                        credits
                      </label>
                    )}
                  </>
                )}
                {error && <p role="alert">{error}</p>}
              </form>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
      {showCalendar && (
        <TaskCalendar
          companyId={id}
          timezone={timezone}
          onCreate={role === 'viewer' ? undefined : openTaskForm}
          onList={() => setListTasks(true)}
          onSelect={(item) => {
            setError('');
            setOpen(item);
          }}
        />
      )}
      {!showCalendar && work.isPending && <p role="status">Loading…</p>}
      {(!showCalendar || open) && work.isError && (
        <p role="alert">
          {errorMessage(work.error)}{' '}
          <button
            onClick={() => {
              void work.refetch();
            }}
          >
            Retry
          </button>
        </p>
      )}
      {error && !selected && !creating && <p role="alert">{error}</p>}
      {!showCalendar && kind !== 'website' && work.data && !items.length && (
        <EmptyState
          title={
            {
              website: 'No websites yet',
              library: 'No files yet',
              inbox: 'No drafts or questions yet',
              schedule: 'No scheduled tasks',
              review: 'No approvals waiting',
            }[kind]
          }
        />
      )}
      {open &&
        !selected &&
        (older.isError ? (
          <p role="alert">{errorMessage(older.error)}</p>
        ) : (
          <p role="status">Opening item…</p>
        ))}
      {kind === 'website' && work.data && (
        <>
          {role !== 'viewer' && (
            <WebsiteImport
              endpoint={root(id) + '/work/websites/import'}
              onImport={async (siteId) => {
                await cache.invalidateQueries({ queryKey: workKey(id) });
                setOpen(siteId);
              }}
            />
          )}
          <BuildCanvas
            websites={items}
            open={(id) => {
              setError('');
              setOpen(id);
            }}
          />
        </>
      )}
      {!showCalendar && kind !== 'website' && (
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              <button
                onClick={() => {
                  setError('');
                  setOpen(item.id);
                }}
              >
                <span>
                  <strong>{item.title}</strong>
                  <small>
                    {item.kind}
                    {item.dueAt
                      ? ' · ' + new Date(item.dueAt).toLocaleString()
                      : ''}
                  </small>
                </span>
                <Pill
                  tone={
                    item.state === 'approved'
                      ? 'good'
                      : item.state === 'pending'
                        ? 'warning'
                        : item.state === 'rejected'
                          ? 'bad'
                          : 'neutral'
                  }
                >
                  {item.state === 'pending' ? 'Needs review' : item.state}
                </Pill>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Dialog.Root
        open={Boolean(selected)}
        onOpenChange={(value) => {
          if (!value) {
            setOpen(null);
            setEditing(null);
            setResponse('');
            setRecipient('');
            setShowVersions(false);
          }
        }}
      >
        {selected && (
          <Dialog.Portal>
            <Dialog.Overlay className={styles.scrim} />
            <Dialog.Content
              className={styles.artifactDialog}
              aria-describedby={undefined}
            >
              <header>
                <Dialog.Title>{selected.title}</Dialog.Title>
                <Dialog.Close asChild>
                  <Button size="icon" variant="quiet" aria-label="Close">
                    ×
                  </Button>
                </Dialog.Close>
              </header>
              {selected.kind === 'website' ? (
                <>
                  {editing ? (
                    <WebsiteEditor
                      draft={editing}
                      busy={busy}
                      onChange={setEditing}
                      onCancel={() => {
                        setEditing(null);
                        setError('');
                      }}
                      onSubmit={(event) => {
                        void saveEdit(event, selected);
                      }}
                    />
                  ) : (
                    <WebsitePreview
                      title="Website draft preview"
                      html={selected.body}
                      pages={selected.pages ?? []}
                    />
                  )}
                  {!editing && selected.state === 'pending' && (
                    <WebsiteReview
                      key={selected.id + ':' + selected.revision}
                      endpoint={root(id) + '/work/' + selected.id + '/review'}
                      revision={selected.revision}
                    />
                  )}
                  {!editing && role !== 'viewer' && (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setError('');
                        setShowVersions(false);
                        setEditing({
                          revision: selected.revision,
                          title: selected.title,
                          body: selected.body,
                          pages: selected.pages ?? [],
                        });
                      }}
                    >
                      Edit website
                    </Button>
                  )}
                  {!editing && (
                    <Button
                      variant="secondary"
                      onClick={() => setShowVersions((current) => !current)}
                      aria-expanded={showVersions}
                    >
                      {showVersions ? 'Hide versions' : 'Recent versions'}
                    </Button>
                  )}
                  {!editing && showVersions && (
                    <WebsiteVersions
                      endpoint={root(id) + '/work/' + selected.id + '/versions'}
                      queryKey={workKey(id)}
                      currentRevision={selected.revision}
                      readOnly={role === 'viewer'}
                    />
                  )}
                  {!editing && (
                    <SiteTools
                      endpoint={
                        root(id) + '/work/' + selected.id + '/deployments'
                      }
                      queryKey={workKey(id)}
                      canRollback={
                        ['owner', 'admin'].includes(role) &&
                        Boolean(work.data?.hosting)
                      }
                    />
                  )}
                </>
              ) : (
                <div className={styles.artifactText}>{selected.body}</div>
              )}
              {selected.kind === 'question' &&
                (selected.answer ? (
                  <section aria-label="Saved answer">
                    <h3>Saved answer</h3>
                    <p className={styles.artifactText}>{selected.answer}</p>
                    <p>{brand.agent} will use it in your next conversation.</p>
                  </section>
                ) : (
                  role !== 'viewer' && (
                    <form
                      className={styles.taskForm}
                      onSubmit={(event) => {
                        void answer(event, selected);
                      }}
                    >
                      <label>
                        Answer {brand.agent}
                        <textarea
                          required
                          rows={4}
                          maxLength={4000}
                          value={response}
                          onChange={(event) =>
                            setResponse(event.currentTarget.value)
                          }
                        />
                      </label>
                      <Button type="submit" disabled={busy || !response.trim()}>
                        Save answer
                      </Button>
                    </form>
                  )
                ))}
              {selected.kind === 'task' && selected.recurrence !== 'once' && (
                <section aria-label="Upcoming occurrences">
                  <h3>Upcoming occurrences</h3>
                  <p>{selected.scheduleTimezone}</p>
                  <ol>
                    {selected.upcoming.map((occurrence) => (
                      <li key={occurrence}>
                        <time dateTime={occurrence}>
                          {new Date(occurrence).toLocaleString(undefined, {
                            timeZone: selected.scheduleTimezone,
                          })}
                        </time>
                      </li>
                    ))}
                  </ol>
                </section>
              )}
              {selected.kind === 'task' && (
                <section aria-label="Scheduled execution">
                  {selected.emailTriggered && (
                    <p>Runs when a new email arrives in this workspace.</p>
                  )}
                  {selected.nextAutomationAt && selected.automatic && (
                    <p>
                      Next Pip turn{' '}
                      <time dateTime={selected.nextAutomationAt}>
                        {new Date(selected.nextAutomationAt).toLocaleString()}
                      </time>
                    </p>
                  )}
                  {selected.latestAutomationTurnId && (
                    <p>
                      <a href={workspacePath(id, 'build')}>View Pip activity</a>
                    </p>
                  )}
                  {(role === 'owner' || role === 'admin') && (
                    <Button
                      variant="secondary"
                      size="small"
                      disabled={busy}
                      onClick={() => void controlSchedule(selected)}
                    >
                      {selected.emailTriggered
                        ? selected.automatic
                          ? 'Pause Inbox trigger'
                          : 'Enable Inbox trigger'
                        : selected.automatic
                          ? 'Pause scheduled execution'
                          : 'Enable scheduled execution'}
                    </Button>
                  )}
                </section>
              )}
              {selected.kind === 'email' && (
                <EmailDeliveryHistory
                  path={root(id) + '/work/' + selected.id + '/email-history'}
                  timezone={timezone}
                />
              )}
              {selected.kind === 'email' && selected.emailState && (
                <section aria-label="Email status">
                  <p>
                    {
                      {
                        queued: 'Queued to send',
                        sending: 'Sending',
                        accepted: 'Accepted by the email provider',
                        failed: 'Send failed',
                        needs_review: 'Check the provider dashboard',
                      }[selected.emailState]
                    }
                    {' · '}
                    {selected.emailRecipient}
                  </p>
                  {selected.emailNote && <p>{selected.emailNote}</p>}
                </section>
              )}
              {selected.kind === 'email' &&
                selected.state === 'approved' &&
                !selected.emailState &&
                (role === 'owner' || role === 'admin') &&
                (outreachSender ? (
                  <form
                    className={styles.taskForm}
                    onSubmit={(event) => void sendEmail(event, selected)}
                  >
                    <p>From {outreachSender}</p>
                    <label>
                      Recipient email address
                      <input
                        type="email"
                        required
                        maxLength={254}
                        value={selected.replyRecipient ?? recipient}
                        readOnly={Boolean(selected.replyRecipient)}
                        onChange={(event) =>
                          setRecipient(event.currentTarget.value)
                        }
                      />
                    </label>
                    <Button type="submit" disabled={busy}>
                      Queue this email
                    </Button>
                  </form>
                ) : (
                  <p>Configure an outreach sender to queue this email.</p>
                ))}
              {!editing &&
                selected.state === 'pending' &&
                ['owner', 'admin'].includes(role) && (
                  <footer>
                    <Button
                      disabled={busy}
                      variant="secondary"
                      onClick={() => {
                        void review(selected, false);
                      }}
                    >
                      Reject draft
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={() => {
                        void review(selected, true);
                      }}
                    >
                      {selected.kind === 'website' && selected.publishWithRun
                        ? 'Approve and queue publication'
                        : 'Approve draft'}
                    </Button>
                  </footer>
                )}
              {!editing && selected.kind === 'website' && (
                <footer>
                  {selected.publicUrl && (
                    <Button asChild variant="secondary">
                      <a
                        href={selected.publicUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View live site
                      </a>
                    </Button>
                  )}
                  {['owner', 'admin'].includes(role) && work.data?.hosting && (
                    <>
                      {selected.publicUrl && (
                        <Button
                          variant="secondary"
                          disabled={busy}
                          onClick={() => {
                            void publication(selected, false);
                          }}
                        >
                          Unpublish
                        </Button>
                      )}
                      {selected.state === 'approved' &&
                        selected.liveDraftRevision !== selected.revision && (
                          <Button
                            disabled={busy}
                            onClick={() => {
                              void publication(selected, true);
                            }}
                          >
                            {selected.publicUrl
                              ? 'Publish update'
                              : 'Publish website'}
                          </Button>
                        )}
                    </>
                  )}
                  {selected.state === 'approved' && !work.data?.hosting && (
                    <p>
                      Configure a site hosting domain to publish this website.
                    </p>
                  )}
                </footer>
              )}
              {error && <p role="alert">{error}</p>}
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </Dialog.Root>
    </section>
  );
}

function SiteTools(props: Parameters<typeof WebsiteDeployments>[0]) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Site tools</summary>
      {open && <WebsiteDeployments {...props} />}
    </details>
  );
}
