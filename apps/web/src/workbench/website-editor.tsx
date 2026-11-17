import { useState } from 'react';
import type { FormEvent } from 'react';
import { websitePages } from '@brightwork/shared';
import type { WebsitePage } from '@brightwork/shared';
import { Button } from '../ui/primitives';
import { WebsitePreview } from './website-preview';
import { WebsiteVisual } from './website-visual';
import styles from './workbench.module.css';

export type WebsiteDraft = {
  revision: number;
  title: string;
  body: string;
  pages: WebsitePage[];
};

export function WebsiteEditor({
  draft,
  busy,
  onChange,
  onCancel,
  onSubmit,
}: {
  draft: WebsiteDraft;
  busy: boolean;
  onChange: (draft: WebsiteDraft) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [index, setIndex] = useState(-1);
  const page = draft.pages[index];
  const html = page?.html ?? draft.body;
  const validPages = websitePages.safeParse(draft.pages).success;

  function changePage(change: Partial<WebsitePage>) {
    if (!page) return;
    onChange({
      ...draft,
      pages: draft.pages.map((other, position) =>
        position === index ? { ...other, ...change } : other,
      ),
    });
  }

  function addPage() {
    let number = 1;
    while (draft.pages.some((item) => item.slug === 'page-' + number))
      number += 1;
    const next = {
      slug: 'page-' + number,
      title: 'Page ' + number,
      html:
        '<main><p><a href="/">Home</a></p><h1>Page ' + number + '</h1></main>',
    };
    onChange({ ...draft, pages: [...draft.pages, next] });
    setIndex(draft.pages.length);
  }

  return (
    <>
      <form
        aria-label="Edit website draft"
        className={styles.taskForm}
        onSubmit={onSubmit}
      >
        <label>
          Website title
          <input
            required
            maxLength={160}
            value={draft.title}
            onChange={(event) =>
              onChange({ ...draft, title: event.currentTarget.value })
            }
          />
        </label>
        <label>
          Page
          <select
            value={index}
            onChange={(event) => setIndex(Number(event.currentTarget.value))}
          >
            <option value={-1}>Homepage</option>
            {draft.pages.map((item, position) => (
              <option key={position} value={position}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.editorActions}>
          <Button
            variant="secondary"
            disabled={busy || draft.pages.length >= 7}
            onClick={addPage}
          >
            Add page
          </Button>
          {page && (
            <Button
              variant="quiet"
              disabled={busy}
              onClick={() => {
                onChange({
                  ...draft,
                  pages: draft.pages.filter(
                    (_, position) => position !== index,
                  ),
                });
                setIndex(-1);
              }}
            >
              Remove page
            </Button>
          )}
        </div>
        {page && (
          <>
            <label>
              Page name
              <input
                required
                maxLength={160}
                value={page.title}
                onChange={(event) =>
                  changePage({ title: event.currentTarget.value })
                }
              />
            </label>
            <label>
              Page address (after /)
              <input
                required
                maxLength={64}
                value={page.slug}
                onChange={(event) =>
                  changePage({ slug: event.currentTarget.value })
                }
              />
            </label>
          </>
        )}
        <WebsiteVisual
          key={index}
          html={html}
          maxLength={page ? 60_000 : 80_000}
          busy={busy}
          onChange={(updated) => {
            if (page) changePage({ html: updated });
            else onChange({ ...draft, body: updated });
          }}
        />
        <label>
          HTML
          <textarea
            required
            rows={10}
            maxLength={page ? 60_000 : 80_000}
            value={html}
            onChange={(event) => {
              const updated = event.currentTarget.value;
              if (page) changePage({ html: updated });
              else onChange({ ...draft, body: updated });
            }}
          />
        </label>
        {!validPages && (
          <p role="status">
            Check the page names, unique addresses, and HTML length.
          </p>
        )}
        <div className={styles.editorActions}>
          <Button variant="secondary" disabled={busy} onClick={onCancel}>
            Cancel edit
          </Button>
          <Button
            type="submit"
            disabled={
              busy || !validPages || !draft.title.trim() || !draft.body.trim()
            }
          >
            Save for review
          </Button>
        </div>
      </form>
      <WebsitePreview title="Website draft preview" html={html} />
    </>
  );
}
