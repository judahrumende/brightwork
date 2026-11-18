import * as Dialog from '@radix-ui/react-dialog';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { brand } from '@brightwork/shared';
import { api, errorMessage } from '../auth/client';
import { Button } from '../ui/primitives';
import { ChatTurn } from './chat-turn';
import type { Turn } from './turn-events';
import styles from './workbench.module.css';

type Conversation = { id: string; title: string; updatedAt: string };

export function ChatHistory({ companyId }: { companyId: string }) {
  const endpoint = '/api/companies/' + companyId + '/ted/chats';
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Conversation>();
  const [remembered, setRemembered] = useState<string>();
  const backButton = useRef<HTMLButtonElement>(null);
  const returnButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    if (selected) backButton.current?.focus();
    else returnButton.current?.focus();
  }, [open, selected]);
  const conversations = useQuery({
    queryKey: [endpoint],
    enabled: open,
    queryFn: ({ signal }) =>
      api<{ conversations: Conversation[] }>(endpoint + '?limit=50', {
        signal,
      }),
  });
  const chat = useQuery({
    queryKey: [endpoint, selected?.id],
    enabled: open && Boolean(selected),
    queryFn: ({ signal }) =>
      api<{ turns: Turn[] }>(endpoint + '/' + selected?.id, { signal }),
  });
  const error = selected ? chat.error : conversations.error;
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setRemembered(undefined);
          setSelected(undefined);
        }
      }}
    >
      <Dialog.Trigger asChild>
        <Button type="button" variant="quiet" size="small">
          Chat history
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.scrim} />
        <Dialog.Content className={styles.artifactDialog}>
          <Dialog.Title>{selected?.title ?? 'Chat history'}</Dialog.Title>
          <Dialog.Description>
            Review previous conversations with {brand.agent}.
          </Dialog.Description>
          <Dialog.Close asChild>
            <Button type="button" variant="quiet">
              Close
            </Button>
          </Dialog.Close>
          {error && <p role="alert">{errorMessage(error)}</p>}
          {selected ? (
            <>
              <Button
                type="button"
                variant="quiet"
                ref={backButton}
                onClick={() => setSelected(undefined)}
              >
                Back to conversations
              </Button>
              {chat.isPending && <p role="status">Loading conversation…</p>}
              {chat.data?.turns.length === 0 && <p>No messages yet.</p>}
              <div className={styles.transcript} aria-label="Saved messages">
                {chat.data?.turns.map((turn) => (
                  <ChatTurn key={turn.id} turn={turn} companyId={companyId} />
                ))}
              </div>
            </>
          ) : (
            <>
              {conversations.isPending && (
                <p role="status">Loading conversations…</p>
              )}
              {conversations.data?.conversations.length === 0 && (
                <p>No conversations yet.</p>
              )}
              <ul>
                {conversations.data?.conversations.map((item) => (
                  <li key={item.id}>
                    <Button
                      type="button"
                      variant="quiet"
                      ref={item.id === remembered ? returnButton : undefined}
                      onClick={() => {
                        setRemembered(item.id);
                        setSelected(item);
                      }}
                    >
                      {item.title}
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
