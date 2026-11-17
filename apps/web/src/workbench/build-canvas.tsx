import { useRef, useState } from 'react';
import { Button, EmptyState, Pill } from '../ui/primitives';
import { WebsitePreview } from './website-preview';
import styles from './build-canvas.module.css';

type Website = {
  id: string;
  title: string;
  body: string;
  publicUrl: string | null;
};

export function BuildCanvas({
  websites,
  open,
}: {
  websites: Website[];
  open: (id: string) => void;
}) {
  const [zoom, setZoom] = useState(100);
  const [hand, setHand] = useState(false);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  const [count, setCount] = useState(12);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const changeZoom = (step: number) =>
    setZoom((value) => Math.min(160, Math.max(50, value + step)));

  return (
    <section className={styles.canvas} aria-label="Website canvas">
      <header>
        <h2>Build</h2>
      </header>
      {websites.length === 0 ? (
        <EmptyState title="No websites yet" />
      ) : (
        <>
          <div
            className={styles.viewport}
            data-hand={hand}
            onPointerDown={(event) => {
              if (
                !hand ||
                event.button !== 0 ||
                !(event.target instanceof Element) ||
                event.target.closest('a,button')
              )
                return;
              drag.current = {
                id: event.pointerId,
                x: event.clientX - origin.x,
                y: event.clientY - origin.y,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const current = drag.current;
              if (current?.id === event.pointerId)
                setOrigin({
                  x: event.clientX - current.x,
                  y: event.clientY - current.y,
                });
            }}
            onLostPointerCapture={() => {
              drag.current = null;
            }}
          >
            <div
              className={styles.cards}
              style={{
                transform: `translate(${origin.x}px, ${origin.y}px) scale(${zoom / 100})`,
              }}
            >
              {websites.slice(0, count).map((site) => (
                <article key={site.id} className={styles.card}>
                  <div className={styles.info}>
                    <strong>{site.title}</strong>
                    <Pill tone={site.publicUrl ? 'good' : 'neutral'}>
                      {site.publicUrl ? 'Live' : 'Draft'}
                    </Pill>
                  </div>
                  <div className={styles.thumbnail}>
                    <WebsitePreview
                      html={site.body}
                      title={site.title + ' draft thumbnail'}
                      thumbnail
                    />
                  </div>
                  <div className={styles.actions}>
                    {site.publicUrl && (
                      <Button asChild size="small" variant="secondary">
                        <a
                          href={site.publicUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Visit site
                        </a>
                      </Button>
                    )}
                    <Button
                      size="small"
                      variant="secondary"
                      aria-label={'Open ' + site.title}
                      onClick={() => open(site.id)}
                    >
                      Open editor
                    </Button>
                  </div>
                </article>
              ))}
              {count < websites.length && (
                <Button
                  variant="secondary"
                  onClick={() => setCount((value) => value + 12)}
                >
                  More websites
                </Button>
              )}
            </div>
          </div>
          <div className={styles.toolbar} aria-label="Canvas controls">
            <Button
              size="small"
              variant={hand ? 'primary' : 'quiet'}
              aria-pressed={hand}
              onClick={() => setHand((value) => !value)}
            >
              Pan
            </Button>
            <Button
              size="small"
              variant="quiet"
              onClick={() => {
                setOrigin({ x: 0, y: 0 });
                setZoom(100);
              }}
            >
              Reset view
            </Button>
            <Button
              size="small"
              variant="quiet"
              aria-label="Zoom out"
              disabled={zoom === 50}
              onClick={() => changeZoom(-10)}
            >
              −
            </Button>
            <output aria-label="Zoom">{zoom}%</output>
            <Button
              size="small"
              variant="quiet"
              aria-label="Zoom in"
              disabled={zoom === 160}
              onClick={() => changeZoom(10)}
            >
              +
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
