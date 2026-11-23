#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const skillRoot = join(__dirname, '..');
const mapPath = join(skillRoot, 'features', 'map.json');

function usage(exitCode = 1) {
  console.error(
    'Usage: node verify-feature.mjs <feature-id> [--smoke]\n' +
      '       node verify-feature.mjs --list',
  );
  process.exit(exitCode);
}

const args = process.argv.slice(2);
if (args.length === 0) usage(1);

const map = JSON.parse(readFileSync(mapPath, 'utf8'));
const features = Array.isArray(map.features) ? map.features : [];
const unmapped = Array.isArray(map.unmapped) ? map.unmapped : [];

if (args[0] === '--list') {
  console.log('mapped:');
  for (const feature of features) {
    console.log(`  ${feature.id}`);
  }
  console.log('unmapped:');
  for (const entry of unmapped) {
    console.log(`  ${entry.id} — ${entry.note ?? ''}`);
  }
  process.exit(0);
}

const smoke = args.includes('--smoke');
const featureId = args.find((arg) => arg !== '--smoke');
if (!featureId) usage(1);

const feature = features.find((entry) => entry.id === featureId);
if (!feature) {
  const listed = unmapped.find((entry) => entry.id === featureId);
  if (listed) {
    console.error(
      `Feature "${featureId}" is listed as unmapped: ${listed.note ?? 'no recipe'}`,
    );
    process.exit(1);
  }
  console.error(
    `Unknown feature id "${featureId}". Run with --list to see ids.`,
  );
  process.exit(1);
}

const recipePath = join(skillRoot, feature.recipe);
console.log(`id: ${feature.id}`);
console.log(`recipe: ${recipePath}`);
console.log(
  `entryRoutes: ${(feature.entryRoutes ?? []).join(', ') || '(none)'}`,
);
console.log(
  `preconditions: ${(feature.preconditions ?? []).join(', ') || '(none)'}`,
);
console.log(`proof: ${(feature.proof ?? []).join(', ') || '(none)'}`);

if (!smoke) {
  process.exit(0);
}

const origin = process.env.APP_ORIGIN;
if (!origin) {
  console.log('smoke: skipped (APP_ORIGIN not set)');
  process.exit(0);
}

const routes = feature.entryRoutes ?? [];
if (routes.length === 0) {
  console.log('smoke: skipped (feature has no entryRoutes; use motion helper)');
  process.exit(0);
}

const route = routes[0].includes(':')
  ? routes[0].replace(':businessId', process.env.VERIFY_BUSINESS_ID ?? 'demo')
  : routes[0];
const url = new URL(route, origin.endsWith('/') ? origin : `${origin}/`).href;

const response = await fetch(url, { redirect: 'manual' });
console.log(`smoke: GET ${url} → ${response.status}`);
if (response.status >= 500) {
  process.exit(1);
}
process.exit(0);
