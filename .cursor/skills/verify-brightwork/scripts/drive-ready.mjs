#!/usr/bin/env node
/**
 * Prove Brightwork /health and /ready on the owned VERIFY_API_BASE.
 * Writes health.json, ready.json, drive-ready.json, and note.md under VERIFY_ROOT.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const base = process.env.VERIFY_API_BASE;
const root = process.env.VERIFY_ROOT;
if (!base || !root) {
  console.error('drive-ready requires VERIFY_API_BASE and VERIFY_ROOT');
  process.exit(1);
}

async function get(path) {
  const response = await fetch(`${base}${path}`, {
    signal: AbortSignal.timeout(5000),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: response.status, json, text };
}

const health = await get('/health');
writeFileSync(join(root, 'health.json'), JSON.stringify(health, null, 2));

const ready = await get('/ready');
writeFileSync(join(root, 'ready.json'), JSON.stringify(ready, null, 2));

const checks = Array.isArray(ready.json?.checks) ? ready.json.checks : [];
const names = checks.map((item) => item.name);
const report = {
  featureId: 'api-readiness',
  entryPoint: `${base}/ready`,
  healthStatus: health.status,
  readyStatus: ready.status,
  readyBodyStatus: ready.json?.status ?? null,
  checkNames: names,
  postgresOk: checks.find((item) => item.name === 'postgres')?.ok === true,
  redisOk: checks.find((item) => item.name === 'redis')?.ok === true,
  minioPresent: names.includes('minio'),
  passed: false,
};

report.passed =
  health.status === 200 &&
  health.json?.status === 'ok' &&
  ready.status === 200 &&
  ready.json?.status === 'ready' &&
  report.postgresOk &&
  report.redisOk &&
  !report.minioPresent;

writeFileSync(join(root, 'drive-ready.json'), JSON.stringify(report, null, 2));
writeFileSync(
  join(root, 'note.md'),
  [
    `# api-readiness proof`,
    ``,
    `- featureId: api-readiness`,
    `- entryPoint: GET ${base}/ready`,
    `- sha: ${(await import('node:child_process'))
      .execSync('git rev-parse HEAD', { encoding: 'utf8' })
      .trim()}`,
    `- health: HTTP ${health.status}`,
    `- ready: HTTP ${ready.status} status=${ready.json?.status}`,
    `- checks: ${names.join(', ') || '(none)'}`,
    `- passed: ${report.passed}`,
    ``,
  ].join('\n'),
);

console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exit(1);
