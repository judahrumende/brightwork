import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import Fastify from 'fastify';
import postgres from 'postgres';
import { accounts, businesses, members } from '../src/db/schema';
import { creditConfig, creditLedger } from '../src/workspace/credits';
import { mediaStore } from '../src/workspace/media-store';

const url = process.env.TEST_DATABASE_URL;
test(
  'Media reserves credits once, recovers polling and refunds proven failures',
  { skip: !url },
  async (t) => {
    assert.ok(url);
    const schema = 'brightwork_media_' + randomUUID().replaceAll('-', '');
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
      .values([{ name: 'Stripe fixture' }, { name: 'Separate business' }])
      .returning();
    assert.ok(owner && other);

    const [user] = await db
      .insert(accounts)
      .values({ email: 'media@example.test' })
      .returning();
    assert.ok(user);
    await db
      .insert(members)
      .values({ accountId: user.id, businessId: owner.id, role: 'owner' });
    const credits = creditLedger(
      db,
      creditConfig.parse({ STARTER_CREDITS: '10' }),
    );
    const media = mediaStore(db, credits);
    const job = {
      id: randomUUID(),
      kind: 'video' as const,
      prompt: 'A sailboat',
      quotedCredits: '4',
    };
    assert.deepEqual(
      await Promise.all([
        media.enqueue(owner.id, user.id, job, '4'),
        media.enqueue(owner.id, user.id, job, '4'),
      ]),
      ['accepted', 'accepted'],
    );
    assert.equal(Number((await credits.open(user.id)).available), 6);
    assert.equal(
      await media.enqueue(
        owner.id,
        user.id,
        { ...job, prompt: 'Other request' },
        '4',
      ),
      'conflict',
    );
    assert.equal(
      await media.enqueue(
        owner.id,
        user.id,
        { ...job, id: randomUUID(), quotedCredits: '10' },
        '10',
      ),
      'insufficient_credits',
    );
    assert.equal(
      await media.enqueue(owner.id, user.id, { ...job, id: randomUUID() }, '5'),
      'price_changed',
    );
    assert.deepEqual(await media.list(other.id), []);
    const now = new Date();
    const claim = await media.claim(['video'], now);
    assert.ok(claim);
    assert.equal(
      await media.record(
        claim,
        { state: 'processing', remoteId: 'vendor-video' },
        now,
      ),
      true,
    );
    assert.equal(await media.claim(['video'], now), null);
    const later = new Date(now.getTime() + 20_000);
    const poll = await mediaStore(db, credits).claim(['video'], later);
    assert.equal(poll?.remoteId, 'vendor-video');
    assert.ok(poll);
    assert.equal(await media.record(claim, { state: 'failed' }), false);
    assert.equal(
      await media.record(poll, {
        state: 'completed',
        bytes: Buffer.from('video fixture'),
      }),
      true,
    );
    assert.equal(
      (await media.asset(owner.id, job.id))?.bytes?.toString(),
      'video fixture',
    );
    assert.equal(await media.asset(other.id, job.id), null);
    const image = {
      ...job,
      id: randomUUID(),
      kind: 'image' as const,
      quotedCredits: '1',
    };
    assert.equal(
      await media.enqueue(owner.id, user.id, image, '1'),
      'accepted',
    );
    const imageClaim = await media.claim(['image']);
    assert.ok(imageClaim);
    assert.equal(await media.record(imageClaim, { state: 'failed' }), true);
    assert.equal(await media.record(imageClaim, { state: 'failed' }), false);
    assert.equal(Number((await credits.open(user.id)).available), 6);
    const voice = {
      ...job,
      id: randomUUID(),
      kind: 'voice' as const,
      quotedCredits: '2',
    };
    assert.equal(
      await media.enqueue(owner.id, user.id, voice, '2'),
      'accepted',
    );
    const voiceClaim = await media.claim(['voice']);
    assert.ok(voiceClaim);
    assert.equal(
      await media.claim(['voice'], new Date(Date.now() + 360_000)),
      null,
    );
    assert.equal(
      (await media.list(owner.id)).find((row) => row.id === voice.id)?.state,
      'needs_review',
    );
    assert.equal(Number((await credits.open(user.id)).available), 4);
    assert.equal(
      await media.record(voiceClaim, {
        state: 'completed',
        bytes: Buffer.from('late receipt'),
      }),
      true,
    );
    assert.equal((await media.asset(owner.id, voice.id))?.mime, 'audio/mpeg');
  },
);
