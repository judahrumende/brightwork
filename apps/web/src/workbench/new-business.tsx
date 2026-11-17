import { useState } from 'react';
import type { FormEvent } from 'react';
import { brand } from '@brightwork/shared';
import { errorMessage, write } from '../auth/client';
import type { Session } from '../auth/client';
import { Sky } from '../sky/sky';
import { Mascot } from '../ui/icons';
import { Button } from '../ui/primitives';
import { usePreferences, workspacePath } from './session';
import styles from './workbench.module.css';

export function NewBusiness({ session }: { session: Session }) {
  usePreferences(session.profile);
  const [name, setName] = useState('');
  const [idea, setIdea] = useState(() => {
    try {
      return sessionStorage.getItem('brightwork-idea') ?? '';
    } catch {
      return '';
    }
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState(Boolean(idea.trim()));
  const [created, setCreated] = useState<string>();

  async function create(event: FormEvent) {
    event.preventDefault();
    if (pending || created || !name.trim()) return;
    setPending(true);
    setError('');
    try {
      const { company } = await write<{ company: { id: string } }>(
        '/api/me/companies/begin',
        { name, idea },
      );
      try {
        sessionStorage.removeItem('brightwork-idea');
      } catch {
        /* Storage is optional. */
      }
      if (!draft || !idea.trim()) {
        location.replace(workspacePath(company.id));
        return;
      }
      setCreated(company.id);
      // Keep creation separate so a failed queue request can still open the workspace.
      const endpoint =
        '/api/companies/' + encodeURIComponent(company.id) + '/pip/turns';
      await write(endpoint, {
        prompt: [
          'Use my saved business idea to draft a short launch plan and a simple homepage.',
          'Save the plan with write_document, then use build to save the homepage as a draft for review.',
          'Use only details provided and ask me about any decision that would materially change the plan.',
        ].join(' '),
      });
      location.replace(workspacePath(company.id, 'build'));
    } catch (failure) {
      setError(errorMessage(failure));
      setPending(false);
    }
  }

  return (
    <main className={styles.centered}>
      <Sky
        plain={session.profile.background === 'plain'}
        reduceEffects={session.profile.reduceEffects}
      />
      <form
        className={styles.centerCard}
        onSubmit={(event) => {
          void create(event);
        }}
      >
        <Mascot />
        <h1>What are you building?</h1>
        <p>
          Give the business a name and tell {brand.agent} what you have in mind.
        </p>
        <label>
          Business name
          <input
            required
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
          />
        </label>
        <label>
          Your idea
          <textarea
            maxLength={4000}
            rows={4}
            value={idea}
            onChange={(event) => setIdea(event.currentTarget.value)}
          />
        </label>
        {!created && idea.trim() && (
          <label className={styles.draftChoice}>
            <input
              type="checkbox"
              checked={draft}
              onChange={(event) => setDraft(event.currentTarget.checked)}
            />
            Have {brand.agent} draft a launch plan and homepage using credits
          </label>
        )}
        {created ? (
          <Button asChild variant="secondary">
            <a href={workspacePath(created, 'build')}>Open Build</a>
          </Button>
        ) : (
          <Button type="submit" disabled={pending}>
            {pending ? 'Creating…' : 'Create workspace'}
          </Button>
        )}
        {created && pending && <p role="status">Starting your first draft…</p>}
        {error && <p role="alert">{error}</p>}
        {session.companyList.lastOpened && (
          <a href="/home">Back to your workspace</a>
        )}
      </form>
    </main>
  );
}
