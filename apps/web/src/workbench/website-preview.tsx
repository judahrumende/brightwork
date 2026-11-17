import { useState } from 'react';
import type { WebsitePage } from '@brightwork/shared';

function previewMarkup(html: string) {
  const template = document.createElement('template');
  template.innerHTML = html;
  const doc = template.content;
  doc
    .querySelectorAll('script,iframe,object,embed,link,meta,base,form')
    .forEach((element) => element.remove());
  doc.querySelectorAll('a,area').forEach((element) => {
    element.removeAttribute('href');
    element.removeAttribute('ping');
  });
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"></head><body>${template.innerHTML}</body></html>`;
}

export function WebsitePreview({
  html,
  title,
  pages = [],
  thumbnail = false,
}: {
  html: string;
  title: string;
  pages?: WebsitePage[];
  thumbnail?: boolean;
}) {
  const [slug, setSlug] = useState('');
  const page = pages.find((item) => item.slug === slug);
  return (
    <>
      {pages.length > 0 && (
        <label>
          Preview page{' '}
          <select
            value={page?.slug ?? ''}
            onChange={(event) => setSlug(event.currentTarget.value)}
          >
            <option value="">Homepage</option>
            {pages.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
      )}
      <iframe
        title={title}
        sandbox=""
        loading={thumbnail ? 'lazy' : 'eager'}
        tabIndex={thumbnail ? -1 : undefined}
        aria-hidden={thumbnail || undefined}
        referrerPolicy="no-referrer"
        srcDoc={previewMarkup(page?.html ?? html)}
      />
    </>
  );
}
