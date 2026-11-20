import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EmailAttempt } from '@brightwork/api/mail';
import { resendMail } from './resend-mail';

const attempt: EmailAttempt = {
  id: '10000000-0000-4000-8000-000000000001',
  sender: 'orders@example.test',
  recipient: 'buyer@example.test',
  subject: 'Order received',
  body: 'Reference: 123',
  replyTo: 'support@example.test',
  inReplyTo: '<message@example.test>',
  attempts: 1,
  firstAttemptAt: new Date('2026-11-20T00:00:00.000Z'),
};

test('Resend sends the queued message with a stable idempotency key', async () => {
  let target = '';
  let options: RequestInit | undefined;
  const send = resendMail('resend-fixture-key', async (input, init) => {
    target = String(input);
    options = init;
    return new Response(JSON.stringify({ id: 'email_fixture_1' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  assert.deepEqual(await send(attempt), {
    kind: 'accepted',
    id: 'email_fixture_1',
  });
  assert.equal(target, 'https://api.resend.com/emails');
  assert.equal(options?.method, 'POST');
  const headers = new Headers(options?.headers);
  assert.equal(headers.get('Authorization'), 'Bearer resend-fixture-key');
  assert.equal(
    headers.get('Idempotency-Key'),
    'brightwork-email-' + attempt.id,
  );
  assert.deepEqual(JSON.parse(String(options?.body)), {
    from: attempt.sender,
    to: [attempt.recipient],
    subject: attempt.subject,
    text: attempt.body,
    reply_to: [attempt.replyTo],
    headers: {
      'In-Reply-To': attempt.inReplyTo,
      References: attempt.inReplyTo,
    },
  });
});

test('Resend retries ambiguous and transient provider failures', async () => {
  for (const status of [408, 409, 429, 500]) {
    const send = resendMail(
      'fixture',
      async () => new Response('', { status }),
    );
    assert.deepEqual(await send(attempt), {
      kind: 'retry',
      note: 'The email provider did not confirm acceptance.',
    });
  }
  const disconnected = resendMail('fixture', async () => {
    throw new Error('network disconnected');
  });
  assert.deepEqual(await disconnected(attempt), {
    kind: 'retry',
    note: 'The email provider did not confirm acceptance.',
  });
});

test('Resend reports a permanent provider rejection without exposing the response', async () => {
  const send = resendMail(
    'fixture',
    async () => new Response('private provider details', { status: 400 }),
  );
  assert.deepEqual(await send(attempt), {
    kind: 'rejected',
    note: 'The email provider rejected this request. Check the sender and recipient.',
  });
});
