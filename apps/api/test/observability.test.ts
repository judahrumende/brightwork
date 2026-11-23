import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseLogLevel } from '../src/observability/log-level';
import { checkReady, requiredUrlProbe } from '../src/observability/ready';
import { initSentry } from '../src/observability/sentry';

describe('parseLogLevel', () => {
  it('defaults empty and unset to info', () => {
    assert.equal(parseLogLevel(undefined), 'info');
    assert.equal(parseLogLevel(''), 'info');
  });

  it('accepts known levels', () => {
    assert.equal(parseLogLevel('warn'), 'warn');
    assert.equal(parseLogLevel('debug'), 'debug');
  });

  it('rejects unknown levels', () => {
    assert.throws(() => parseLogLevel('verbose'));
  });
});

describe('checkReady', () => {
  it('reports ready when every probe passes', async () => {
    const report = await checkReady([
      { name: 'a', check: async () => undefined },
      { name: 'b', check: async () => undefined },
    ]);
    assert.equal(report.status, 'ready');
    assert.deepEqual(report.checks, [
      { name: 'a', ok: true },
      { name: 'b', ok: true },
    ]);
  });

  it('reports not_ready when a probe fails and keeps later probes', async () => {
    const report = await checkReady([
      {
        name: 'fail',
        check: async () => {
          throw new Error('down');
        },
      },
      { name: 'ok', check: async () => undefined },
    ]);
    assert.equal(report.status, 'not_ready');
    assert.equal(report.checks[0]?.ok, false);
    assert.equal(report.checks[0]?.detail, 'down');
    assert.equal(report.checks[1]?.ok, true);
  });

  it('requiredUrlProbe fails when unset', async () => {
    const report = await checkReady([requiredUrlProbe('postgres', undefined)]);
    assert.equal(report.status, 'not_ready');
    assert.match(report.checks[0]?.detail ?? '', /not configured/u);
  });
});

describe('initSentry', () => {
  it('stays disabled when DSN is unset', async () => {
    const result = await initSentry({
      dsn: undefined,
      environment: undefined,
      service: 'api',
    });
    assert.deepEqual(result, { enabled: false, reason: 'unset' });
  });

  it('stays disabled for blank DSN', async () => {
    const result = await initSentry({
      dsn: '  ',
      environment: 'test',
      service: 'api',
    });
    assert.deepEqual(result, { enabled: false, reason: 'unset' });
  });
});
