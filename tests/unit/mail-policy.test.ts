import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  emailOutcome,
  mayAttemptEmail,
} from '../../apps/api/src/workspace/mail-policy.ts';
import { resendMail } from '../../apps/worker/src/resend-mail.ts';

const first = new Date('2026-11-16T12:00:00Z');

test('email retries stop before the provider expires the idempotency key', () => {
  const retry = { kind: 'retry', note: 'Status unknown' } as const;
  assert.equal(emailOutcome(retry, 1, first, first).state, 'queued');
  assert.equal(emailOutcome(retry, 4, first, first).state, 'needs_review');
  assert.equal(
    mayAttemptEmail(1, first, new Date('2026-11-17T11:00:00Z')),
    false,
  );
  assert.equal(
    emailOutcome({ kind: 'rejected', note: 'Invalid sender' }, 1, first, first)
      .state,
    'failed',
  );
});

test('email retry preserves the body, recipient and provider idempotency key', async () => {
  const requests: { key: string | null; payload: unknown }[] = [];
  const send = resendMail('fixture', async (url, init) => {
    assert.equal(url, 'https://api.resend.com/emails');
    requests.push({
      key: new Headers(init?.headers).get('Idempotency-Key'),
      payload: JSON.parse(String(init?.body)),
    });
    return requests.length === 1
      ? new Response('', { status: 503 })
      : Response.json({ id: 'email-fixture' });
  });
  const input = {
    id: 'fixture',
    sender: 'sender@example.test',
    recipient: 'recipient@example.test',
    subject: 'Launch',
    body: 'A draft approved by an owner.',
    attempts: 1,
    firstAttemptAt: first,
  };
  assert.equal((await send(input)).kind, 'retry');
  assert.deepEqual(await send({ ...input, attempts: 2 }), {
    kind: 'accepted',
    id: 'email-fixture',
  });
  assert.deepEqual(requests[0], requests[1]);
});
