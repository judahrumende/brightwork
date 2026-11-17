import { Fragment } from 'react';
import styles from './workbench.module.css';

type Citation = { url: string; title: string; end_index: number };

function source(value: unknown): value is Citation {
  if (typeof value !== 'object' || value === null) return false;
  if (!('url' in value) || !('title' in value) || !('end_index' in value))
    return false;
  if (
    typeof value.url !== 'string' ||
    typeof value.title !== 'string' ||
    typeof value.end_index !== 'number' ||
    !Number.isSafeInteger(value.end_index) ||
    value.end_index < 0
  )
    return false;
  try {
    const url = new URL(value.url);
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function sections(output: unknown) {
  if (
    typeof output !== 'object' ||
    output === null ||
    !('sections' in output) ||
    !Array.isArray(output.sections)
  )
    return [];
  return (output.sections as unknown[]).flatMap((item) => {
    if (
      typeof item !== 'object' ||
      item === null ||
      !('text' in item) ||
      typeof item.text !== 'string'
    )
      return [];
    return [
      {
        text: item.text,
        citations:
          'citations' in item && Array.isArray(item.citations)
            ? item.citations.filter(source)
            : [],
      },
    ];
  });
}

function CitedText({
  text,
  citations,
}: {
  text: string;
  citations: Citation[];
}) {
  const characters = Array.from(text);
  const ordered = [...citations].sort((a, b) => a.end_index - b.end_index);
  const references = ordered.map((citation, index) => {
    const start = index === 0 ? 0 : ordered[index - 1]!.end_index;
    const preceding = characters.slice(start, citation.end_index).join('');
    return (
      <Fragment key={citation.url + ':' + index}>
        {preceding}{' '}
        <a href={citation.url} target="_blank" rel="noreferrer">
          {citation.title || new URL(citation.url).hostname}
        </a>{' '}
      </Fragment>
    );
  });
  return (
    <p>
      {references}
      {characters.slice(ordered.at(-1)?.end_index ?? 0).join('')}
    </p>
  );
}

export function ResearchResults({ output }: { output: unknown }) {
  const results = sections(output);
  if (!results.length) return null;
  return (
    <details className={styles.researchResults}>
      <summary>Research findings and sources</summary>
      {results.map(({ text, citations }, index) => (
        <CitedText key={index} text={text} citations={citations} />
      ))}
    </details>
  );
}
