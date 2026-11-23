#!/usr/bin/env node
/**
 * Drive Pip computer actions and write motion evidence (PNGs + optional WebM).
 * Verification scaffolding — not a production entrypoint.
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

const outDir = path.resolve(
  arg('--out', path.join(repoRoot, 'output/verify-brightwork/computer')),
);
const chrome =
  arg(
    '--chrome',
    process.env.COMPUTER_CHROMIUM_PATH ||
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ) || undefined;

await mkdir(outDir, { recursive: true });

const sessionUrl = pathToFileURL(
  path.join(repoRoot, 'apps/worker/src/computer-session.ts'),
).href;
const { playwrightComputer } = await import(sessionUrl);
const computer = playwrightComputer(
  chrome ? { executablePath: chrome } : undefined,
);

async function frameToPng(rawBuffer) {
  // Computer session captures JPEG into pngBase64 for size; convert for stamping.
  const tmpIn = path.join(outDir, '.frame-in.bin');
  const tmpPng = path.join(outDir, '.frame.png');
  await writeFile(tmpIn, rawBuffer);
  const sniff = rawBuffer.subarray(0, 8);
  const isPng =
    sniff[0] === 0x89 &&
    sniff[1] === 0x50 &&
    sniff[2] === 0x4e &&
    sniff[3] === 0x47;
  if (isPng) return rawBuffer;
  const converted = spawnSync(
    'sips',
    ['-s', 'format', 'png', tmpIn, '--out', tmpPng],
    { encoding: 'utf8' },
  );
  if (converted.status !== 0)
    throw new Error(`sips png convert failed: ${converted.stderr}`);
  return readFile(tmpPng);
}

function stampCursor(pngBuffer, cursor, label) {
  const png = PNG.sync.read(pngBuffer);
  const cx = Math.round(cursor.x);
  const cy = Math.round(cursor.y);
  const paint = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
    const i = (png.width * y + x) << 2;
    png.data[i] = r;
    png.data[i + 1] = g;
    png.data[i + 2] = b;
    png.data[i + 3] = a;
  };
  for (let d = -14; d <= 14; d++) {
    paint(cx + d, cy, 220, 38, 38);
    paint(cx, cy + d, 220, 38, 38);
  }
  for (let y = -5; y <= 5; y++)
    for (let x = -5; x <= 5; x++)
      if (x * x + y * y <= 25) paint(cx + x, cy + y, 250, 204, 21);
  for (let y = 8; y < 36; y++)
    for (let x = 8; x < 8 + Math.min(360, 12 + label.length * 9); x++)
      paint(x, y, 15, 23, 42, 210);
  return PNG.sync.write(png);
}

const steps = [
  {
    id: '01-navigate',
    action: { action: 'navigate', url: 'https://example.com/' },
  },
  { id: '02-move', action: { action: 'move', x: 640, y: 120 } },
  {
    id: '03-click',
    action: { action: 'click', x: 640, y: 520, button: 'left' },
  },
  { id: '04-type', action: { action: 'type', text: 'brightwork-verify' } },
  { id: '05-key', action: { action: 'key', key: 'Tab' } },
  {
    id: '06-scroll',
    action: { action: 'scroll', x: 640, y: 400, deltaX: 0, deltaY: 500 },
  },
  { id: '07-screenshot', action: { action: 'screenshot' } },
];

const frames = [];
try {
  for (const step of steps) {
    const frame = await computer.apply(step.action);
    if (!frame.pngBase64)
      throw new Error(
        `No PNG from computer after ${step.id}; is Chromium available?`,
      );
    const asPng = await frameToPng(Buffer.from(frame.pngBase64, 'base64'));
    const stamped = stampCursor(asPng, frame.cursor, step.id);
    const file = path.join(outDir, `computer-${step.id}.png`);
    await writeFile(file, stamped);
    frames.push({
      id: step.id,
      action: step.action,
      url: frame.url,
      cursor: frame.cursor,
      text: frame.text.slice(0, 240),
      lastKey: frame.lastKey,
      png: path.basename(file),
    });
    console.log(
      `wrote ${file} url=${frame.url} cursor=${frame.cursor.x},${frame.cursor.y}`,
    );
  }
} finally {
  await computer.close();
}

await writeFile(
  path.join(outDir, 'computer-frames.json'),
  JSON.stringify(frames, null, 2),
);

const ffmpegCandidates = [
  'ffmpeg',
  path.join(
    process.env.HOME || '',
    'Library/Caches/ms-playwright/ffmpeg-1013/ffmpeg-mac',
  ),
];
let ffmpeg = null;
let ffmpegKind = 'full';
for (const candidate of ffmpegCandidates) {
  const probe = spawnSync(candidate, ['-version'], { encoding: 'utf8' });
  if (probe.status === 0) {
    ffmpeg = candidate;
    ffmpegKind = candidate.includes('ms-playwright') ? 'playwright' : 'full';
    break;
  }
}

if (ffmpeg && ffmpegKind === 'full') {
  const listPath = path.join(outDir, 'computer-frames.txt');
  await writeFile(
    listPath,
    frames
      .flatMap((frame) => [
        `file '${path.join(outDir, frame.png)}'`,
        'duration 0.75',
      ])
      .concat([`file '${path.join(outDir, frames.at(-1).png)}'`])
      .join('\n') + '\n',
  );
  const mp4 = path.join(outDir, 'computer-motion.mp4');
  const result = spawnSync(
    ffmpeg,
    [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listPath,
      '-vf',
      'fps=2,format=yuv420p',
      '-movflags',
      '+faststart',
      mp4,
    ],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    throw new Error('ffmpeg failed to build computer-motion.mp4');
  }
  console.log(`wrote ${mp4}`);
} else if (ffmpeg) {
  // Playwright's ffmpeg: mjpeg pipe → VP9 WebM only.
  const webm = path.join(outDir, 'computer-motion.webm');
  const child = spawn(
    ffmpeg,
    [
      '-y',
      '-f',
      'image2pipe',
      '-framerate',
      '2',
      '-c:v',
      'mjpeg',
      '-i',
      'pipe:0',
      '-c:v',
      'libvpx_vp9',
      '-b:v',
      '0',
      '-crf',
      '32',
      webm,
    ],
    { stdio: ['pipe', 'inherit', 'inherit'] },
  );
  for (const frame of frames) {
    const pngPath = path.join(outDir, frame.png);
    const jpgPath = path.join(outDir, frame.png.replace(/\.png$/u, '.jpg'));
    const sips = spawnSync(
      'sips',
      ['-s', 'format', 'jpeg', pngPath, '--out', jpgPath],
      { encoding: 'utf8' },
    );
    if (sips.status !== 0)
      throw new Error(`sips failed: ${sips.stderr || sips.stdout}`);
    child.stdin.write(await readFile(jpgPath));
  }
  child.stdin.end();
  const code = await new Promise((resolve) => child.on('close', resolve));
  if (code !== 0) throw new Error('playwright ffmpeg failed to build webm');
  console.log(`wrote ${webm}`);
} else {
  console.warn('ffmpeg not found; PNG sequence only');
}

const html = `<!doctype html>
<meta charset="utf-8" />
<title>Pip computer motion</title>
<style>
  body { margin: 0; background: #0f172a; color: #e2e8f0; font: 14px ui-sans-serif, system-ui; }
  main { max-width: 1280px; margin: 0 auto; padding: 16px; }
  img { width: 100%; background: #fff; border-radius: 8px; }
  #meta { margin: 12px 0; opacity: 0.9; }
</style>
<main>
  <h1>Pip computer motion</h1>
  <p id="meta"></p>
  <img id="frame" alt="computer frame" />
</main>
<script type="application/json" id="data">${JSON.stringify(frames)}</script>
<script>
  const frames = JSON.parse(document.getElementById('data').textContent);
  let i = 0;
  const img = document.getElementById('frame');
  const meta = document.getElementById('meta');
  const tick = () => {
    const f = frames[i % frames.length];
    img.src = f.png;
    meta.textContent = f.id + ' · ' + f.url + ' · cursor ' + f.cursor.x + ',' + f.cursor.y;
    i += 1;
  };
  tick();
  setInterval(tick, 750);
</script>`;
await writeFile(path.join(outDir, 'computer-motion.html'), html);
console.log(`frames=${frames.length} out=${outDir}`);
