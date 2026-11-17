/// <reference lib="webworker" />
import type { SkyMessage } from './protocol';

const worker = self as unknown as DedicatedWorkerGlobalScope;
let canvas: OffscreenCanvas | undefined;
let context: OffscreenCanvasRenderingContext2D | null;
let clouds: ImageBitmap | undefined;
let width = 0;
let height = 0;
let visible = true;
let timer: ReturnType<typeof setTimeout> | undefined;
let firstFrame = true;
let offset = 0;

function draw() {
  timer = undefined;
  if (!canvas || !context || !clouds || !width || !height || !visible) return;

  const scale = Math.max(width / clouds.width, height / clouds.height);
  const imageWidth = clouds.width * scale;
  const imageHeight = clouds.height * scale;
  const pan = Math.sin(offset) * width * 0.016;
  context.clearRect(0, 0, width, height);
  context.drawImage(
    clouds,
    (width - imageWidth) / 2 + pan,
    (height - imageHeight) / 2,
    imageWidth,
    imageHeight,
  );

  if (firstFrame) {
    firstFrame = false;
    worker.postMessage('ready');
  }

  offset += 0.0028;
  timer = setTimeout(draw, 1000 / 24);
}

function redraw() {
  clearTimeout(timer);
  draw();
}

async function load(target: OffscreenCanvas, source: string) {
  canvas = target;
  context = target.getContext('2d');
  if (!context) throw new Error('Canvas 2D unavailable');
  const response = await fetch(source);
  if (!response.ok) throw new Error('Cloud layer could not load');
  clouds = await createImageBitmap(await response.blob());
  redraw();
}

worker.onmessage = ({ data }: MessageEvent<SkyMessage>) => {
  if (data.type === 'start') {
    void load(data.canvas, data.source).catch(() =>
      worker.postMessage('fallback'),
    );
    return;
  }
  if (data.type === 'visibility') {
    visible = data.visible;
    redraw();
    return;
  }
  if (!canvas) return;
  width = Math.max(1, Math.round(data.width * data.ratio));
  height = Math.max(1, Math.round(data.height * data.ratio));
  canvas.width = width;
  canvas.height = height;
  redraw();
};
