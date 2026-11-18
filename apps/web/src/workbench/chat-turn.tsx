import { ResearchResults } from './research-results';
import type { Turn } from './turn-events';
import styles from './workbench.module.css';

export function ChatTurn({
  companyId,
  turn,
}: {
  companyId: string;
  turn: Turn;
}) {
  return (
    <article>
      <p className={styles.userMessage}>{turn.prompt}</p>
      {turn.attachments?.map((file) => (
        <a
          key={file.id}
          href={
            '/api/companies/' +
            companyId +
            '/pip/turns/' +
            turn.id +
            '/attachments/' +
            file.id
          }
          download={file.name}
        >
          {file.name}
        </a>
      ))}
      {turn.parts
        .filter((part) => part.type === 'tool')
        .map((part) => (
          <div key={part.toolCallId}>
            <p className={styles.tool}>
              {part.name.replace(/_/gu, ' ')} · {part.status}
            </p>
            {(part.name === 'web_search' ||
              part.name === 'read_public_page') && (
              <ResearchResults output={part.output} />
            )}
          </div>
        ))}
      {turn.text ? (
        <p className={styles.reply}>{turn.text}</p>
      ) : (
        <p role="status">
          {turn.status === 'queued'
            ? 'Queued'
            : turn.status === 'failed'
              ? 'This turn couldn’t finish.'
              : 'Working…'}
        </p>
      )}
    </article>
  );
}
