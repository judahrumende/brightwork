import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { brand } from '@brightwork/shared';
import { Sky } from '../sky/sky';
import { Icon, Mascot } from './icons';
import {
  FloatingPanel,
  Hint,
  Menu,
  Modal,
  ModalClose,
  TooltipProvider,
} from './overlays';
import { Button, EmptyState, Pill, Segmented, Skeleton } from './primitives';
import { Toasts, useToast } from './toasts';
import styles from './ui-gallery.module.css';

const themes = ['Light', 'Dark'] as const;
const ranges = ['7D', '30D', '90D', '12M'];
const tones = ['Warm', 'Direct', 'Playful', 'Expert'];
const options = (choices: readonly string[]) =>
  choices.map((label) => ({ label, value: label }));

function Sample({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.sample}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Samples() {
  const [range, setRange] = useState('30D');
  const [tone, setTone] = useState('Warm');
  const [saved, setSaved] = useState(false);
  const [workspace, setWorkspace] = useState('Nummi Demo');
  const [draftName, setDraftName] = useState(workspace);
  const notice = useToast();

  function save() {
    setSaved(true);
    notice({
      title: 'Changes saved',
      description: 'Your workspace is up to date.',
      action: {
        label: 'Undo',
        altText: 'Undo saving the changes',
        onClick: () => setSaved(false),
      },
    });
  }

  function rename() {
    const newName = draftName.trim();
    const previousName = workspace;
    setWorkspace(newName);
    notice({
      title: 'Workspace renamed',
      description: newName,
      action: {
        label: 'Undo',
        altText: 'Restore the previous workspace name',
        onClick: () =>
          setWorkspace((current) =>
            current === newName ? previousName : current,
          ),
      },
    });
  }

  return (
    <div className={styles.grid}>
      <Sample title="Buttons">
        <div className={styles.row}>
          <Button onClick={save}>Save changes</Button>
          <Button
            variant="secondary"
            onClick={() => setSaved(false)}
            disabled={!saved}
          >
            Reset
          </Button>
          <FloatingPanel
            trigger={<Button variant="quiet">More</Button>}
            label="More actions"
          >
            <div className={styles.row}>
              <Button variant="accent" onClick={save}>
                Save changes
              </Button>
              <Button
                variant="danger"
                onClick={() => setSaved(false)}
                disabled={!saved}
              >
                Discard
              </Button>
            </div>
          </FloatingPanel>
          <span className={styles.secondary} aria-live="polite">
            {saved ? 'Saved' : 'Ready to save'}
          </span>
        </div>
      </Sample>
      <Sample title="Pills and segmented controls">
        <div className={styles.row}>
          <Pill>Draft</Pill>
          <Pill tone="good">
            <Icon name="check" size={12} /> Live
          </Pill>
          <Pill tone="warning">Needs review</Pill>
          <Pill tone="bad">Paused</Pill>
        </div>
        <div className={styles.row}>
          <Segmented
            label="Report window"
            options={options(ranges)}
            value={range}
            onValueChange={setRange}
          />
        </div>
      </Sample>
      <Sample title="Menus and popovers">
        <div className={styles.row}>
          <Menu
            trigger={
              <Button variant="secondary">
                Tone · {tone}
                <Icon name="chevron" size={14} />
              </Button>
            }
            entries={tones.map((value) => ({
              id: value,
              label: value,
              selected: tone === value,
              onSelect: () => setTone(value),
            }))}
          />
          <FloatingPanel
            trigger={<Button variant="secondary">Open browser</Button>}
            label="Browser"
            side="top"
            width={464}
          >
            <h3 className={styles.panelTitle}>Browser</h3>
            <EmptyState
              icon={<BrowserDrawing />}
              className={styles.browserEmpty ?? ''}
              title={`${brand.agent} hasn’t used the browser yet`}
              description={`History will appear here after ${brand.agent} visits a page.`}
            />
          </FloatingPanel>
        </div>
      </Sample>
      <Sample title="Dialogs and sheets">
        <div className={styles.row}>
          <Modal
            title="Workspace preferences"
            description="Choose how this workspace opens."
            trigger={
              <Button
                variant="secondary"
                onClick={() => setDraftName(workspace)}
              >
                Open modal
              </Button>
            }
          >
            <label className={styles.field}>
              Workspace name
              <input
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
              />
            </label>
            <div className={styles.dialogActions}>
              <ModalClose asChild>
                <Button variant="quiet">Cancel</Button>
              </ModalClose>
              <ModalClose asChild>
                <Button
                  onClick={rename}
                  disabled={!draftName.trim() || draftName.trim() === workspace}
                >
                  Save changes
                </Button>
              </ModalClose>
            </div>
          </Modal>
          <Modal
            title="Review a site update"
            kind="sheet"
            description="Choose which version to keep."
            trigger={<Button variant="secondary">Open sheet</Button>}
          >
            <div className={styles.dialogActions}>
              <ModalClose asChild>
                <Button variant="quiet" onClick={() => setSaved(false)}>
                  Keep current
                </Button>
              </ModalClose>
              <ModalClose asChild>
                <Button onClick={save}>Approve update</Button>
              </ModalClose>
            </div>
          </Modal>
        </div>
      </Sample>
      <Sample title="Toasts and shortcuts">
        <div className={styles.row}>
          <Button variant="secondary" onClick={save}>
            Show toast
          </Button>
          <Hint label="Search workspace" keys={['⌘', 'K']}>
            <Button
              variant="quiet"
              size="icon"
              aria-label="Search workspace"
              aria-keyshortcuts="Meta+K Control+K"
              onClick={() =>
                notice({
                  title: 'Search shortcut',
                  description:
                    'The workspace search uses Command or Control with K.',
                })
              }
            >
              <Icon name="search" />
            </Button>
          </Hint>
        </div>
      </Sample>
      <Sample title="Loading and empty states">
        <div className={styles.states}>
          <div
            className={styles.loading}
            role="status"
            aria-label="Loading workspace"
          >
            <Skeleton width={44} height={36} />
            <Skeleton width="80%" />
            <Skeleton width="55%" />
          </div>
          <EmptyState
            icon={<Icon name="folder" size={30} />}
            title="No files yet"
            description={`Files created by you or ${brand.agent} will appear here.`}
          />
        </div>
      </Sample>
    </div>
  );
}

function BrowserDrawing() {
  return (
    <svg
      className={styles.browserDrawing}
      viewBox="0 0 172 102"
      width="172"
      height="102"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x=".5"
        y=".5"
        width="171"
        height="101"
        rx="10"
        fill="var(--surface-pure)"
        stroke="var(--whisper)"
      />
      <path d="M1 24h170" stroke="var(--whisper)" />
      <path
        d="M12 13h.1m9 0h.1m9 0h.1"
        stroke="var(--border-subtle)"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <rect
        x="43"
        y="7"
        width="120"
        height="13"
        rx="6.5"
        fill="var(--surface-raised)"
      />
      <path
        d="M13 65h112m-112 10h144m-144 10h62"
        stroke="var(--surface-raised)"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <rect
        x="10"
        y="33"
        width="152"
        height="22"
        rx="4"
        fill="var(--surface-raised)"
      />
    </svg>
  );
}

export function UiGallery() {
  const [theme, setTheme] = useState('Light');
  const [reduceEffects, setReduceEffects] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme.toLowerCase();
    root.toggleAttribute('data-reduce-effects', reduceEffects);
    return () => {
      delete root.dataset.theme;
      root.removeAttribute('data-reduce-effects');
    };
  }, [theme, reduceEffects]);

  return (
    <TooltipProvider delayDuration={300}>
      <Toasts>
        <main className={styles.gallery}>
          <Sky reduceEffects={reduceEffects} />
          <header className={styles.header}>
            <span className={styles.brand}>
              <img src="/mark.svg" alt="" width="24" height="24" />
              {brand.product}
            </span>
            <div className={styles.row}>
              <Segmented
                label="Theme"
                options={options(themes)}
                value={theme}
                onValueChange={setTheme}
              />
              <Button
                aria-pressed={reduceEffects}
                onClick={() => setReduceEffects((value) => !value)}
                variant={reduceEffects ? 'accent' : 'secondary'}
              >
                Reduce effects
              </Button>
            </div>
          </header>
          <div className={styles.content}>
            <div className={styles.title}>
              <Mascot size={54} />
              <h1>UI preview</h1>
            </div>
            <Samples />
          </div>
        </main>
      </Toasts>
    </TooltipProvider>
  );
}
