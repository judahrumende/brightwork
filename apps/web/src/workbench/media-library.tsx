import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { api, errorMessage, write } from '../auth/client';
import { Button } from '../ui/primitives';
import styles from './workbench.module.css';

const kinds = ['image', 'video', 'voice'] as const;
type Kind = (typeof kinds)[number];
const names: Record<Kind, string> = {
  image: 'Image',
  video: 'Video',
  voice: 'Voice',
};
type Job = {
  id: string;
  siteId?: string | null;
  kind: Kind;
  state: string;
  prompt: string;
  credits: string;
};
type Request = {
  id: string;
  siteId?: string;
  kind: Kind;
  prompt: string;
  quotedCredits: string;
};
const states: Record<string, string> = {
  queued: 'Queued',
  submitting: 'Submitting',
  processing: 'Generating',
  completed: 'Ready',
  failed: 'Failed · credits returned',
  needs_review: 'Needs review',
};

export function MediaLibrary({
  companyId,
  readOnly,
}: {
  companyId: string;
  readOnly: boolean;
}) {
  const endpoint = '/api/companies/' + companyId + '/media';
  const client = useQueryClient();
  const result = useQuery({
    queryKey: [endpoint],
    queryFn: ({ signal }) =>
      api<{ rates: Partial<Record<Kind, string>>; jobs: Job[] }>(endpoint, {
        signal,
      }),
    refetchInterval: (query) =>
      query.state.data?.jobs?.some((job) =>
        ['queued', 'submitting', 'processing'].includes(job.state),
      )
        ? 4000
        : false,
  });
  const projects = useQuery({
    queryKey: ['/api/companies/' + companyId + '/work/projects'],
    queryFn: ({ signal }) =>
      api<{
        projects: { id: string; title: string; kind: 'app' | 'store' }[];
      }>('/api/companies/' + companyId + '/work/projects', { signal }),
    enabled: Boolean(
      result.data &&
      (Object.keys(result.data.rates).length > 0 || result.data.jobs.length),
    ),
  });
  const last = useRef<Request | null>(null);
  const [selected, setSelected] = useState<Kind | ''>('');
  const [projectId, setProjectId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const enabled = kinds.filter(
    (kind) => result.data?.rates?.[kind] !== undefined,
  );
  const kind = enabled.find((item) => item === selected) ?? enabled[0];
  const cost = kind && result.data?.rates?.[kind];
  const jobs = result.data?.jobs ?? [];
  const projectNames = new Map(
    projects.data?.projects.map((project) => [project.id, project.title]) ?? [],
  );
  if (!enabled.length && !jobs.length) return null;
  return (
    <section aria-label="Generated media">
      <h2>Media</h2>
      {!readOnly && kind && cost !== undefined && (
        <form
          className={styles.taskForm}
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy || !prompt.trim()) return;
            const body = prompt.trim();
            if (
              last.current?.kind !== kind ||
              last.current.siteId !== (projectId || undefined) ||
              last.current.prompt !== body ||
              last.current.quotedCredits !== cost
            )
              last.current = {
                id: crypto.randomUUID(),
                ...(projectId ? { siteId: projectId } : {}),
                kind,
                prompt: body,
                quotedCredits: cost,
              };
            setBusy(true);
            setError('');
            try {
              await write(endpoint, last.current);
              last.current = null;
              setPrompt('');
              await client.invalidateQueries({ queryKey: [endpoint] });
            } catch (failure) {
              setError(errorMessage(failure));
            } finally {
              setBusy(false);
            }
          }}
        >
          {projects.data?.projects.length ? (
            <label>
              Attach media usage to
              <select
                value={projectId}
                disabled={busy}
                onChange={(event) => setProjectId(event.target.value)}
              >
                <option value="">Workspace media</option>
                {projects.data.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.title} · {project.kind}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            Media type
            <select
              value={kind}
              disabled={busy}
              onChange={(event) => {
                const choice = enabled.find(
                  (item) => item === event.target.value,
                );
                if (choice) setSelected(choice);
              }}
            >
              {enabled.map((item) => (
                <option key={item} value={item}>
                  {names[item]} · {result.data?.rates?.[item]} credits
                </option>
              ))}
            </select>
          </label>
          <label>
            {kind === 'voice' ? 'Script' : 'Prompt'}
            <textarea
              required
              maxLength={4000}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
          </label>
          {kind === 'voice' && <p>Voice generation uses an AI voice.</p>}
          <Button type="submit" disabled={busy}>
            Generate for {cost} credits
          </Button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
      {jobs.length > 0 && (
        <ul aria-label="Media jobs">
          {jobs.map((job) => (
            <li key={job.id}>
              <p>
                {names[job.kind]} · {states[job.state] ?? job.state} ·{' '}
                {Number(job.credits)} credits
              </p>
              {job.siteId && (
                <p>Project: {projectNames.get(job.siteId) ?? 'Unavailable'}</p>
              )}
              <p>{job.prompt}</p>
              {job.state === 'completed' && (
                <a href={endpoint + '/' + job.id + '/asset'}>
                  Download {names[job.kind].toLowerCase()}
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
