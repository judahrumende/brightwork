import * as Slot from '@radix-ui/react-slot';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import styles from './primitives.module.css';

type ButtonProps = ComponentPropsWithRef<'button'> & {
  variant?: 'primary' | 'secondary' | 'quiet' | 'accent' | 'danger';
  size?: 'small' | 'medium' | 'large' | 'icon';
  shape?: 'pill' | 'rounded';
  asChild?: boolean;
};

export function Button({
  asChild = false,
  variant = 'primary',
  size = 'medium',
  shape = 'pill',
  type = 'button',
  className = '',
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot.Root : 'button';
  return (
    <Component
      {...props}
      {...(asChild ? {} : { type })}
      className={`${styles.button} ${className}`}
      data-variant={variant}
      data-size={size}
      data-shape={shape}
    />
  );
}

export function Pill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'good' | 'warning' | 'bad';
}) {
  return (
    <span className={styles.pill} data-tone={tone}>
      {children}
    </span>
  );
}

export function Segmented({
  label,
  options,
  value,
  onValueChange,
}: {
  label: string;
  options: ReadonlyArray<{ label: string; value: string; disabled?: boolean }>;
  value: string;
  onValueChange: (value: string) => void;
}) {
  return (
    <ToggleGroup.Root
      className={styles.segmented}
      aria-label={label}
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next) onValueChange(next);
      }}
    >
      {options.map((option) => (
        <ToggleGroup.Item
          className={styles.segment}
          key={option.value}
          value={option.value}
          disabled={option.disabled ?? false}
        >
          {option.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}

export function Skeleton({
  width = '100%',
  height = 12,
}: {
  width?: string | number;
  height?: number;
}) {
  return (
    <span
      aria-hidden="true"
      className={styles.skeleton}
      style={{ width, height }}
    />
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className = '',
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`${styles.empty} ${className}`}>
      {icon && (
        <div className={styles.emptyIcon} aria-hidden="true">
          {icon}
        </div>
      )}
      <p className={styles.emptyTitle}>{title}</p>
      {description && <p className={styles.emptyDescription}>{description}</p>}
      {action && <div className={styles.emptyAction}>{action}</div>}
    </div>
  );
}
