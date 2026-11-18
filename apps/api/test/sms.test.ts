import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import Fastify from 'fastify';
import postgres from 'postgres';
import { businesses } from '../src/db/schema';
import { workspaceSms } from '../src/workspace/sms';

const url = process.env.TEST_DATABASE_URL;
const origin = 'https://brightwork.example.test';
const accountSid = 'AC' + '1'.repeat(32);
const numberSid = 'PN' + '2'.repeat(32);
const providerId = 'SM' + '3'.repeat(32);
const workspaceNumber = '+15550100003';
const peer = '+15550100009';
const token = 'fixture-token-first-' + '0'.repeat(12);
const rotated = 'fixture-token-second-' + '0'.repeat(12);

test(
  'Twilio SMS lifecycle stays scoped and never retries an ambiguous submission',
  { skip: !url },
  async (t) => {
    assert.ok(url);
    const schema = 'brightwork_sms_' + randomUUID().replaceAll('-', '');
    const admin = postgres(url, { max: 1, onnotice: () => {} });
    const connection = postgres(url, {
      max: 5,
      onnotice: () => {},
      connection: { search_path: schema },
    });
    const db = drizzle(connection);
    const app = Fastify();
    t.after(async () => {
      await app.close();
      await connection.end();
      await admin`drop schema if exists ${admin(schema)} cascade`;
      await admin.end();
    });
    await admin`create schema ${admin(schema)}`;
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
      migrationsSchema: schema,
    });
    const [owner, other] = await db
      .insert(businesses)
      .values([{ name: 'SMS fixture' }, { name: 'Separate business' }])
      .returning();
    assert.ok(owner && other);

    const hook = '/api/webhooks/twilio/' + owner.id;
    function deliver(path: string, input: Record<string, string>, key = token) {
      const data = { AccountSid: accountSid, ...input };
      const signed = Object.entries(data).sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      );
      const signature = createHmac('sha1', key)
        .update(origin + path + signed.flat().join(''))
        .digest('base64');
      return app.inject({
        method: 'POST',
        url: path,
        payload: new URLSearchParams(data).toString(),
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-twilio-signature': signature,
        },
      });
    }
    const incoming = {
      To: workspaceNumber,
      From: peer,
      MessageSid: 'SM' + '4'.repeat(32),
      Body: 'Hello',
    };
    const send = { id: randomUUID(), recipient: peer, body: 'Thanks' };
    const delivery = {
      MessageSid: providerId,
      MessageStatus: 'delivered',
      From: workspaceNumber,
      To: peer,
    };
    let submissions = 0;
    let timeout = false;
    let activeToken = token;
    const sms = workspaceSms(
      db,
      '12'.repeat(32),
      origin,
      async (target, options) => {
        const path = new URL(String(target)).pathname;
        assert.equal(
          new Headers(options?.headers).get('authorization'),
          'Basic ' +
            Buffer.from(accountSid + ':' + activeToken).toString('base64'),
        );
        if (path.endsWith('/IncomingPhoneNumbers/' + numberSid + '.json')) {
          return Response.json({
            sid: numberSid,
            account_sid: accountSid,
            phone_number: workspaceNumber,
            capabilities: { sms: true },
          });
        }
        assert.ok(path.endsWith('/Messages.json'));
        assert.ok(options?.body instanceof URLSearchParams);
        assert.equal(options.body.get('From'), workspaceNumber);
        assert.equal(options.body.get('To'), peer);
        submissions++;
        if (timeout) throw new Error('lost provider response');
        assert.equal(
          options.body.get('StatusCallback'),
          origin + hook + '/' + send.id,
        );
        assert.equal(
          (await deliver(hook + '/' + send.id, delivery)).statusCode,
          204,
        );
        return Response.json({ sid: providerId, status: 'queued' });
      },
    );
    sms.register(app);
    assert.equal(
      await sms.connect(owner.id, { accountSid, numberSid, token }),
      true,
    );
    await assert.rejects(
      sms.connect(other.id, { accountSid, numberSid, token }),
    );
    assert.equal((await deliver(hook, incoming, rotated)).statusCode, 403);
    assert.equal(
      (await deliver(hook, { ...incoming, AccountSid: 'AC' + '5'.repeat(32) }))
        .statusCode,
      403,
    );
    assert.equal(
      (await deliver(hook, { ...incoming, To: peer })).statusCode,
      400,
    );
    assert.equal((await deliver(hook, incoming)).body, '<Response/>');
    assert.equal((await deliver(hook, incoming)).statusCode, 200);
    assert.equal((await sms.list(owner.id)).length, 1);
    assert.deepEqual(await sms.list(other.id), []);
    assert.match((await sms.reply(other.id, send)).error ?? '', /Connect/);
    await Promise.all([sms.reply(owner.id, send), sms.reply(owner.id, send)]);
    assert.equal(submissions, 1);
    assert.deepEqual(await sms.reply(owner.id, send), { status: 'delivered' });
    assert.equal(
      (
        await deliver(hook + '/' + send.id, {
          ...delivery,
          MessageStatus: 'sent',
        })
      ).statusCode,
      204,
    );
    assert.equal((await sms.list(owner.id))[0]?.status, 'delivered');

    await deliver(hook, {
      ...incoming,
      MessageSid: 'SM' + '6'.repeat(32),
      Body: 'STOP',
    });
    assert.match(
      (await sms.reply(owner.id, { ...send, id: randomUUID() })).error ?? '',
      /opted out/,
    );
    await deliver(hook, {
      ...incoming,
      MessageSid: 'SM' + '7'.repeat(32),
      Body: 'START',
    });
    timeout = true;
    const retry = { ...send, id: randomUUID() };
    assert.deepEqual(await sms.reply(owner.id, retry), {
      status: 'needs_review',
    });
    assert.deepEqual(await sms.reply(owner.id, retry), {
      status: 'needs_review',
    });
    assert.equal(submissions, 2);
    await sms.disconnect(owner.id);
    assert.equal((await deliver(hook, incoming)).statusCode, 403);
    assert.match((await sms.reply(owner.id, retry)).error ?? '', /Connect/);
    activeToken = rotated;
    assert.equal(
      await sms.connect(owner.id, { accountSid, numberSid, token: rotated }),
      true,
    );
    assert.equal((await deliver(hook, incoming)).statusCode, 403);
    assert.equal((await deliver(hook, incoming, rotated)).statusCode, 200);
    assert.equal((await sms.connection(owner.id))?.connected, true);
  },
);
