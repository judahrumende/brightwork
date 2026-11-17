import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const output = new URL('../docs/visual-diff.html', import.meta.url);
const results = new URL('../test-results/visual/', import.meta.url);
const authExclusions = [
  { x: 35, y: 16, width: 170, height: 36 },
  { x: 0, y: 408, width: 665, height: 492 },
  { x: 888, y: 231, width: 384, height: 33 },
  { x: 973, y: 305, width: 210, height: 18 },
  { x: 973, y: 355, width: 210, height: 20 },
  { x: 888, y: 569, width: 384, height: 92 },
];
const cases = [
  {
    title: 'Browser popover empty state',
    baseline: '005-home-browser-empty.png',
    actual: 'foundation-browser-empty.png',
    crop: { x: 236, y: 319, width: 464, height: 248 },
    exclusions: [
      { x: 17, y: 19, width: 78, height: 22 },
      { x: 142, y: 53, width: 178, height: 105 },
      { x: 110, y: 168, width: 244, height: 61 },
    ],
  },
  {
    title: 'Sign-in page',
    baseline: 'public/sign-in.png',
    actual: 'auth-sign-in.png',
    exclusions: authExclusions,
  },
  {
    title: 'Sign-up page',
    baseline: 'public/sign-up.png',
    actual: 'auth-sign-up.png',
    exclusions: authExclusions,
  },
  {
    title: 'Visitors overview',
    baseline: '084-visitors-overview.png',
    actual: '084-visitors-overview.png',
  },
  {
    title: 'Visitors date range',
    baseline: '085-visitors-range-menu.png',
    actual: '085-visitors-range-menu.png',
  },
  ...[
    ['Schedule month', '052-schedule-month.png'],
    ['Schedule week', '053-schedule-week.png'],
    ['New scheduled task', '056-schedule-new-task.png'],
    ['New calendar event', '057-schedule-new-event.png'],
    ['Run summary', '077-run-summary-window.png'],
  ].map(([title, file]) => ({ title, baseline: file, actual: file })),
];

function load(file) {
  return PNG.sync.read(readFileSync(file));
}

function cropImage(image, clip) {
  if (!clip) return image;
  const cropped = new PNG({ width: clip.width, height: clip.height });
  PNG.bitblt(image, cropped, clip.x, clip.y, clip.width, clip.height, 0, 0);
  return cropped;
}

function contained(image, width, height) {
  if (image.width === width && image.height === height) return image;
  const output = new PNG({ width, height });
  const x = Math.floor((width - image.width) / 2);
  const y = Math.floor((height - image.height) / 2);
  PNG.bitblt(image, output, 0, 0, image.width, image.height, x, y);
  return output;
}

function dataImage(image, label) {
  const data = PNG.sync.write(image).toString('base64');
  return `<figure><figcaption>${label}</figcaption><img alt="${label}" src="data:image/png;base64,${data}"></figure>`;
}

function exclude(expected, received, width, exclusions) {
  const ignored = new Set();
  for (const region of exclusions) {
    for (let y = region.y; y < region.y + region.height; y += 1) {
      for (let x = region.x; x < region.x + region.width; x += 1) {
        const pixel = y * width + x;
        expected.fill(0, pixel * 4, pixel * 4 + 4);
        received.fill(0, pixel * 4, pixel * 4 + 4);
        ignored.add(pixel);
      }
    }
  }
  return ignored;
}

function compare({ title, baseline, actual, crop, exclusions = [] }) {
  const reference = new URL(`../kit/screens/${baseline}`, import.meta.url);
  const capture = new URL(actual, results);
  const missing = [reference, capture].filter((file) => !existsSync(file));
  if (missing.length) {
    for (const file of missing)
      console.error(`Missing visual input: ${file.pathname}`);
    process.exitCode = 1;
    return `<section><h2>${title}</h2><p>Awaiting ${missing.map((file) => (file === reference ? 'reference' : 'Playwright capture')).join(' and ')}.</p></section>`;
  }

  const expected = cropImage(load(reference), crop);
  const received = load(capture);
  const width = Math.max(expected.width, received.width);
  const height = Math.max(expected.height, received.height);
  const diff = new PNG({ width, height });
  const baselinePixels = Buffer.from(contained(expected, width, height).data);
  const capturePixels = Buffer.from(contained(received, width, height).data);
  const ignored = exclude(baselinePixels, capturePixels, width, exclusions);
  const pixels = pixelmatch(
    baselinePixels,
    capturePixels,
    diff.data,
    width,
    height,
    {
      threshold: 0.1,
    },
  );
  for (const pixel of ignored) diff.data.fill(0, pixel * 4, pixel * 4 + 4);
  const area = width * height - ignored.size;
  const ratio = ((100 * pixels) / area).toFixed(2);
  const dimensions = [expected, received].map(
    (image) => `${image.width} × ${image.height}`,
  );
  return `<section><h2>${title}</h2><p>${ratio}% different outside text and replacement artwork. Kit ${dimensions[0]} px. Brightwork ${dimensions[1]} px.</p>
    <div class="row">${dataImage(expected, 'Kit')}${dataImage(received, 'Brightwork')}${dataImage(diff, 'Difference')}</div></section>`;
}

mkdirSync(new URL('.', output), { recursive: true });
writeFileSync(
  output,
  `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Brightwork visual comparisons</title>
<style>
body{font:15px/1.5 system-ui,sans-serif;max-width:1440px;margin:32px auto;padding:0 20px;color:#1c1f26;background:#f4f7fa}
.row{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}figure{margin:0}img{width:100%;height:auto}section{padding:16px 0}
</style>
<h1>Brightwork visual comparisons</h1>
${cases.map(compare).join('\n')}
</html>`,
);
