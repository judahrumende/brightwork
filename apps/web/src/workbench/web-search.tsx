import { useEffect, useRef, useState } from 'react';
import {
  publicSearchHits,
  type PublicSearchHits,
  webSearchRequest,
  webSearchResponse,
  type WebSearchResponse,
} from '@brightwork/shared';
import { api, ApiError, type Company } from '../auth/client';
import { Icon } from '../ui/icons';
import { Button } from '../ui/primitives';
import { workspacePath } from './session';
import styles from './web-search.module.css';

const historyLimit = 6;
function readHistory(key: string) {
  try {
    const items: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    if (Array.isArray(items)) {
      return items
        .flatMap((question: unknown) => {
          const parsed = webSearchRequest.safeParse({ question });
          return parsed.success ? [parsed.data.question] : [];
        })
        .slice(0, historyLimit);
    }
  } catch {
    /* Search works when browser storage is unavailable. */
  }
  return [];
}

function searchError(error: unknown) {
  if (error instanceof ApiError) {
    switch (error.status) {
      case 401:
        return 'Your session has expired. Sign in again to search.';
      case 403:
        return 'Search requires edit access to this workspace.';
      case 422:
        return 'There wasn’t enough evidence to answer. Try a more specific question.';
      case 429:
        return 'You’ve reached a search limit. Wait before trying again.';
      case 502:
      case 503:
        return 'A research service is unavailable. Try again shortly.';
      case 504:
        return 'Research took too long. Try again or narrow your question.';
      default:
        return error.message;
    }
  }
  return 'Research couldn’t be completed. Try again.';
}

type SearchState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'canceled' }
  | { kind: 'answer'; data: WebSearchResponse }
  | { kind: 'links'; data: PublicSearchHits }
  | {
      kind: 'error';
      question: string;
      message: string;
      status?: number;
      sourcesOnly: boolean;
    };

export function WebSearch({
  accountId,
  company,
}: {
  accountId: string;
  company: Company;
}) {
  const storageKey = `brightwork-research:${accountId}:${company.id}`;
  const [recent, setRecent] = useState(() => readHistory(storageKey));
  const [question, setQuestion] = useState('');
  const [state, setState] = useState<SearchState>({ kind: 'idle' });
  const active = useRef<AbortController | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const pending = state.kind === 'loading';
  const canSearch = company.role !== 'viewer';
  const parsed = webSearchRequest.safeParse({ question });

  useEffect(() => () => active.current?.abort(), []);

  function saveHistory(items: string[]) {
    setRecent(items);
    try {
      if (items.length) localStorage.setItem(storageKey, JSON.stringify(items));
      else localStorage.removeItem(storageKey);
    } catch {
      /* Keep in-memory history for this view. */
    }
  }

  async function search(value: string, sourcesOnly = false) {
    const request = webSearchRequest.safeParse({ question: value });
    if (!request.success || active.current || !canSearch) return;
    const controller = new AbortController();
    active.current = controller;
    setQuestion(request.data.question);
    setState({ kind: 'loading' });
    try {
      if (sourcesOnly) {
        const data = publicSearchHits.parse(
          await api<unknown>(
            `/api/companies/${encodeURIComponent(company.id)}/growth/sources`,
            {
              method: 'POST',
              body: JSON.stringify({ query: request.data.question }),
              signal: controller.signal,
            },
          ),
        );
        if (!controller.signal.aborted) setState({ kind: 'links', data });
        return;
      }
      const data = webSearchResponse.parse(
        await api<unknown>(
          `/api/companies/${encodeURIComponent(company.id)}/web-search`,
          {
            method: 'POST',
            body: JSON.stringify(request.data),
            signal: controller.signal,
          },
        ),
      );
      if (controller.signal.aborted) return;
      saveHistory(
        [
          request.data.question,
          ...recent.filter((item) => item !== request.data.question),
        ].slice(0, historyLimit),
      );
      setState({ kind: 'answer', data });
    } catch (error) {
      if (!controller.signal.aborted)
        setState({
          kind: 'error',
          question: request.data.question,
          message: searchError(error),
          sourcesOnly,
          ...(error instanceof ApiError ? { status: error.status } : {}),
        });
    } finally {
      if (active.current === controller) active.current = null;
    }
  }

  return (
    <section className={styles.page} aria-labelledby="research-title">
      <h1 id="research-title">Research</h1>
      <form
        className={styles.form}
        role="search"
        aria-label="Web research"
        onSubmit={(event) => {
          event.preventDefault();
          void search(question);
        }}
      >
        <label htmlFor="research-question">Ask a question</label>
        <div className={styles.controls}>
          <input
            ref={field}
            id="research-question"
            type="search"
            placeholder="What would you like to know?"
            maxLength={500}
            value={question}
            readOnly={pending || !canSearch}
            onChange={(event) => setQuestion(event.target.value)}
            aria-describedby="research-privacy"
          />
          <Button
            type="submit"
            disabled={!parsed.success || pending || !canSearch}
          >
            <Icon name="search" size={16} /> Search
          </Button>
          {!pending && (
            <Button
              type="button"
              variant="secondary"
              disabled={!parsed.success || !canSearch}
              onClick={() => void search(question, true)}
            >
              Find source links
            </Button>
          )}
          {pending && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                active.current?.abort();
                active.current = null;
                setState({ kind: 'canceled' });
                field.current?.focus();
              }}
            >
              Cancel
            </Button>
          )}
        </div>
        <p id="research-privacy" className={styles.muted}>
          Web search finds sources. Generating an answer also sends your
          question to the configured model provider.
        </p>
      </form>
      {!canSearch && (
        <p role="status">Search requires edit access to this workspace.</p>
      )}
      {canSearch && state.kind === 'idle' && (
        <p className={styles.empty}>
          Search the web to get an answer with sources.
        </p>
      )}
      {pending && (
        <p className={styles.feedback} role="status">
          Searching and checking sources…
        </p>
      )}
      {state.kind === 'canceled' && (
        <p className={styles.feedback} role="status">
          Search canceled.
        </p>
      )}
      {state.kind === 'error' && (
        <div className={styles.feedback}>
          <p role="alert">{state.message}</p>
          {state.status === 401 ? (
            <Button asChild size="small" variant="secondary">
              <a
                href={
                  '/sign-in?returnTo=' +
                  encodeURIComponent(workspacePath(company.id, 'research'))
                }
              >
                Sign in
              </a>
            </Button>
          ) : (
            state.status !== 403 && (
              <Button
                type="button"
                size="small"
                variant="secondary"
                onClick={() => void search(state.question, state.sourcesOnly)}
              >
                Retry search
              </Button>
            )
          )}
        </div>
      )}
      {state.kind === 'answer' && <SearchAnswer data={state.data} />}
      {state.kind === 'links' && (
        <section
          className={styles.results}
          aria-labelledby="research-live-sources"
        >
          <h2 id="research-live-sources">Live source links</h2>
          {!state.data.hits.length ? (
            <p role="status">No source links found.</p>
          ) : (
            <ol className={styles.sources}>
              {state.data.hits.map(({ title, url, excerpt }) => (
                <li key={url}>
                  <a href={url} target="_blank" rel="noopener noreferrer">
                    {title}
                  </a>
                  <span className={styles.muted}>{new URL(url).hostname}</span>
                  {excerpt && <p>{excerpt}</p>}
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
      {recent.length > 0 && (
        <section className={styles.recent} aria-labelledby="research-recent">
          <div className={styles.recentHeader}>
            <h2 id="research-recent">Recent searches</h2>
            <Button
              type="button"
              size="small"
              variant="quiet"
              disabled={pending}
              onClick={() => saveHistory([])}
            >
              Clear history
            </Button>
          </div>
          <ul>
            {recent.map((item) => (
              <li key={item}>
                <button
                  type="button"
                  disabled={pending || !canSearch}
                  onClick={() => {
                    setQuestion(item);
                    field.current?.focus();
                  }}
                >
                  {item}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}

function SearchAnswer({ data }: { data: WebSearchResponse }) {
  const titles = new Map(data.sources.map(({ id, title }) => [id, title]));
  return (
    <div className={styles.results}>
      <p className={styles.visuallyHidden} role="status">
        Research complete. {data.sources.length}{' '}
        {data.sources.length === 1 ? 'source' : 'sources'}.
      </p>
      <section aria-labelledby="research-answer">
        <h2 id="research-answer">Answer</h2>
        {data.answer.map(({ text, citations }, index) => (
          <p key={index}>
            {text}{' '}
            {citations.map(({ sourceId }) => (
              <a
                key={sourceId}
                className={styles.citation}
                href={`#research-source-${sourceId}`}
                aria-label={`Source ${sourceId.slice(1)}: ${titles.get(sourceId)}`}
              >
                [{sourceId.slice(1)}]
              </a>
            ))}
          </p>
        ))}
      </section>
      <section aria-labelledby="research-sources">
        <h2 id="research-sources">Sources</h2>
        <ol className={styles.sources}>
          {data.sources.map(({ id, title, url, snippet }) => (
            <li key={id} id={`research-source-${id}`} tabIndex={-1}>
              <a href={url} target="_blank" rel="noopener noreferrer">
                {title}
              </a>
              <span className={styles.muted}>{new URL(url).hostname}</span>
              <details>
                <summary>Evidence excerpt</summary>
                <blockquote>{snippet}</blockquote>
              </details>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
