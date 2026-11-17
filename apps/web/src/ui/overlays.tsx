import * as Dialog from '@radix-ui/react-dialog';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import * as Popover from '@radix-ui/react-popover';
import * as Tooltip from '@radix-ui/react-tooltip';
import type { ReactElement, ReactNode } from 'react';
import { Button } from './primitives';
import { Icon } from './icons';
import styles from './overlays.module.css';

export function Modal({
  children,
  trigger,
  title,
  description,
  kind = 'modal',
}: {
  children: ReactNode;
  trigger: ReactElement;
  title: string;
  description?: string;
  kind?: 'modal' | 'sheet';
}) {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.scrim} />
        <Dialog.Content
          className={styles.dialog}
          data-kind={kind}
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          <header className={styles.dialogHeader}>
            <div>
              <Dialog.Title className={styles.dialogTitle}>
                {title}
              </Dialog.Title>
              {description && (
                <Dialog.Description className={styles.description}>
                  {description}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild>
              <Button variant="quiet" size="icon" aria-label="Close">
                <Icon name="close" />
              </Button>
            </Dialog.Close>
          </header>
          <div className={styles.dialogBody}>{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export const ModalClose = Dialog.Close;

export function FloatingPanel({
  trigger,
  children,
  label,
  side = 'bottom',
  width = 340,
}: {
  trigger: ReactElement;
  children: ReactNode;
  label: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  width?: number;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className={styles.popover}
          aria-label={label}
          side={side}
          sideOffset={10}
          collisionPadding={12}
          style={{ width }}
        >
          <Popover.Arrow className={styles.arrow} width={20} height={10} />
          <div className={styles.popoverBody}>{children}</div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export type MenuEntry = {
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  selected?: boolean;
  destructive?: boolean;
};

export function Menu({
  trigger,
  entries,
  align = 'start',
}: {
  trigger: ReactElement;
  entries: readonly MenuEntry[];
  align?: 'start' | 'center' | 'end';
}) {
  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>{trigger}</Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          className={styles.menu}
          sideOffset={6}
          collisionPadding={12}
          align={align}
          loop
        >
          {entries.map((entry) => {
            const props = {
              className: styles.menuItem,
              disabled: entry.disabled ?? false,
              onSelect: entry.onSelect,
              'data-destructive': entry.destructive,
            };
            if (entry.selected === undefined) {
              return (
                <Dropdown.Item key={entry.id} {...props}>
                  {entry.label}
                </Dropdown.Item>
              );
            }
            return (
              <Dropdown.CheckboxItem
                key={entry.id}
                {...props}
                checked={entry.selected}
              >
                {entry.label}
                <Dropdown.ItemIndicator>
                  <Icon name="check" />
                </Dropdown.ItemIndicator>
              </Dropdown.CheckboxItem>
            );
          })}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

export const TooltipProvider = Tooltip.Provider;

export function Hint({
  children,
  label,
  keys = [],
}: {
  children: ReactElement;
  label: string;
  keys?: readonly string[];
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          className={styles.tooltip}
          sideOffset={7}
          collisionPadding={12}
        >
          {label}
          {keys.length > 0 && (
            <span className={styles.keys} aria-label={keys.join(' plus ')}>
              {keys.map((key) => (
                <kbd key={key}>{key}</kbd>
              ))}
            </span>
          )}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
