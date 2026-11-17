import * as Toast from '@radix-ui/react-toast';
import { createContext, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Icon } from './icons';
import { Button } from './primitives';
import styles from './overlays.module.css';

type Notice = {
  title: string;
  description?: string;
  action?: { label: string; altText: string; onClick: () => void };
};

const ToastContext = createContext<((notice: Notice) => void) | null>(null);

export function Toasts({ children }: { children: ReactNode }) {
  const [notices, setNotices] = useState<(Notice & { id: string })[]>([]);
  const publish = useMemo(
    () => (notice: Notice) => {
      const id = crypto.randomUUID();
      setNotices((current) => [...current, { ...notice, id }]);
    },
    [],
  );

  return (
    <Toast.Provider swipeDirection="right">
      <ToastContext.Provider value={publish}>{children}</ToastContext.Provider>
      {notices.map((notice) => (
        <Toast.Root
          key={notice.id}
          className={styles.toast}
          onOpenChange={(open) => {
            if (!open)
              setNotices((current) =>
                current.filter(({ id }) => id !== notice.id),
              );
          }}
        >
          <span className={styles.toastIcon}>
            <Icon name="check" />
          </span>
          <div>
            <Toast.Title className={styles.toastTitle}>
              {notice.title}
            </Toast.Title>
            {notice.description && (
              <Toast.Description className={styles.description}>
                {notice.description}
              </Toast.Description>
            )}
          </div>
          {notice.action && (
            <Toast.Action altText={notice.action.altText} asChild>
              <Button
                size="small"
                variant="quiet"
                onClick={notice.action.onClick}
              >
                {notice.action.label}
              </Button>
            </Toast.Action>
          )}
          <Toast.Close asChild>
            <Button
              size="icon"
              variant="quiet"
              aria-label="Dismiss notification"
            >
              <Icon name="close" />
            </Button>
          </Toast.Close>
        </Toast.Root>
      ))}
      <Toast.Viewport className={styles.toastViewport} />
    </Toast.Provider>
  );
}

export function useToast() {
  const publish = useContext(ToastContext);
  if (!publish) throw new Error('useToast must be rendered inside Toasts');
  return publish;
}
