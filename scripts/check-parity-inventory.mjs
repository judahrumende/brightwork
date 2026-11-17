import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const screens = JSON.parse(read('../kit/screen-index.json'));
const { observed, referencedNotCalled } = JSON.parse(
  read('../kit/api-shapes.json'),
);
const visualCases = read('./visual-report.mjs');

assert.equal(screens.length, 86);
assert.equal(new Set(screens.map((screen) => screen.file)).size, 86);
for (const [index, screen] of screens.entries()) {
  assert.equal(screen.number, index + 1);
  assert.match(
    screen.file,
    new RegExp('^' + String(screen.number).padStart(3, '0') + '-[^/]+\\.png$'),
  );
  assert.ok(screen.title.trim());
  assert.equal(screen.localComparison, visualCases.includes(screen.file));
}

const contracts = new Set(
  observed.map(({ method, path }) => `${method} ${path}`),
);
assert.equal(observed.length, 147);
assert.equal(contracts.size, observed.length);
assert.equal(referencedNotCalled.length, 70);
assert.equal(new Set(referencedNotCalled).size, 70);
const observedPaths = new Set(observed.map(({ path }) => path));
const unobserved = referencedNotCalled.filter(
  (path) => !observedPaths.has(path),
);
console.log(
  `${screens.length} tour screens, ${contracts.size} observed API pairs, ${unobserved.length} referenced paths with a capture gap`,
);
