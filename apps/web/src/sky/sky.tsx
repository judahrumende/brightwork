import { useEffect, useRef, useState } from 'react';
import type { SkyMessage } from './protocol';
import desktop from './clouds-desktop.webp';
import landing from './clouds-landing.webp';
import quiet from './clouds-quiet.webp';
import styles from './sky.module.css';

const sources = { desktop, landing, quiet };

export function Sky({
  scene = 'desktop',
  reduceEffects = false,
  plain = false,
}: {
  scene?: keyof typeof sources;
  reduceEffects?: boolean;
  plain?: boolean;
}) {
  const layer = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const source = sources[scene];

  useEffect(() => {
    const container = layer.current;
    if (
      !container ||
      plain ||
      reduceEffects ||
      typeof Worker !== 'function' ||
      typeof HTMLCanvasElement.prototype.transferControlToOffscreen !==
        'function'
    )
      return;

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');

    function run(element: HTMLDivElement) {
      const canvas = document.createElement('canvas');
      const worker = new Worker(
        new URL('./clouds.worker.ts', import.meta.url),
        { type: 'module' },
      );
      element.append(canvas);
      const post = (message: SkyMessage, transfer: Transferable[] = []) =>
        worker.postMessage(message, transfer);
      let failed = false;
      const fallback = () => {
        failed = true;
        canvas.remove();
        setReady(false);
        worker.terminate();
      };
      const resize = () => {
        if (!failed)
          post({
            type: 'resize',
            width: element.clientWidth,
            height: element.clientHeight,
            ratio: Math.min(window.devicePixelRatio, 1.5),
          });
      };
      const visibility = () => {
        if (!failed) post({ type: 'visibility', visible: !document.hidden });
      };
      worker.onmessage = ({ data }) => {
        if (data === 'ready') setReady(true);
        if (data === 'fallback') fallback();
      };
      worker.onerror = fallback;

      try {
        const offscreen = canvas.transferControlToOffscreen();
        post(
          {
            type: 'start',
            canvas: offscreen,
            source: new URL(source, document.baseURI).href,
          },
          [offscreen],
        );
      } catch {
        fallback();
        return undefined;
      }

      const observer = new ResizeObserver(resize);
      observer.observe(element);
      visibility();
      resize();
      document.addEventListener('visibilitychange', visibility);
      return () => {
        observer.disconnect();
        document.removeEventListener('visibilitychange', visibility);
        worker.terminate();
        canvas.remove();
      };
    }

    let stop: ReturnType<typeof run>;
    const sync = () => {
      stop?.();
      stop = undefined;
      setReady(false);
      if (motion.matches) return;
      try {
        stop = run(container);
      } catch {
        // A blocked worker leaves the original static layer visible.
      }
    };
    sync();
    motion.addEventListener('change', sync);
    return () => {
      motion.removeEventListener('change', sync);
      stop?.();
    };
  }, [plain, reduceEffects, source]);

  return (
    <div
      className={styles.sky}
      aria-hidden="true"
      data-scene={scene}
      data-plain={plain}
      data-animated={ready && !reduceEffects && !plain}
    >
      {!plain && <img className={styles.still} src={source} alt="" />}
      <div className={styles.layer} ref={layer} />
    </div>
  );
}
