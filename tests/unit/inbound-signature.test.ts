import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { verifyInboundSignature } from '../../apps/api/src/workspace/inbound-signature.ts';

const time = 1794916800000;
const key = Buffer.alloc(32, 31);
const secret = 'whsec_' + key.toString('base64');
const id = 'msg_test';
const timestamp = String(time / 1000);
const body = Buffer.from('{ "type": "email.received", "subject": "Olá" }');
const signature = createHmac('sha256', key)
  .update(`${id}.${timestamp}.`)
  .update(body)
  .digest('base64');
const headers = {
  'svix-id': id,
  'svix-timestamp': timestamp,
  'svix-signature': `v2,unknown v1,${Buffer.alloc(32).toString('base64')} v1,${signature}`,
};

test('inbound webhook authenticates the original bytes and supports signature rotation', () => {
  assert.equal(verifyInboundSignature(secret, body, headers, time), true);
  const reformatted = Buffer.from(JSON.stringify(JSON.parse(body.toString())));
  assert.equal(
    verifyInboundSignature(secret, reformatted, headers, time),
    false,
  );
  assert.equal(
    verifyInboundSignature(
      secret,
      body,
      { ...headers, 'svix-id': 'other' },
      time,
    ),
    false,
  );
});

test('inbound webhook rejects replay timestamps and malformed or duplicate headers', () => {
  assert.equal(
    verifyInboundSignature(secret, body, headers, time + 301_000),
    false,
  );
  assert.equal(
    verifyInboundSignature(secret, body, headers, time - 301_000),
    false,
  );
  assert.equal(
    verifyInboundSignature('whsec_dGlueQ==', body, headers, time),
    false,
  );
  assert.equal(
    verifyInboundSignature(
      secret,
      body,
      { ...headers, 'svix-signature': ['v1,' + signature] },
      time,
    ),
    false,
  );
  assert.equal(
    verifyInboundSignature(
      secret,
      body,
      { ...headers, 'svix-timestamp': 'junk' },
      time,
    ),
    false,
  );
});
