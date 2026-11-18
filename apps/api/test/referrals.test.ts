import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import Fastify from 'fastify';
import postgres from 'postgres';
import { accounts, creditEntries } from '../src/db/schema';
import { authStore } from '../src/auth/store';
import { eq } from 'drizzle-orm';
import {
  attributeReferral,
  reconcileReferral,
  referralProgram,
} from '../src/workspace/referrals';

const url = process.env.TEST_DATABASE_URL;
test(
  'Referral sign-up attribution and credit reconciliation are single-use and refundable',
  { skip: !url },
  async (t) => {
    assert.ok(url);
    const schema = 'brightwork_referrals_' + randomUUID().replaceAll('-', '');
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
      .insert(accounts)
      .values([
        { email: 'source@example.test' },
        { email: 'other@example.test' },
      ])
      .returning();
    assert.ok(owner && other);
    const program = referralProgram(db);
    const { code } = await program.status(owner.id);
    const competing = await program.status(other.id);
    assert.equal(await program.valid(code), true);
    assert.equal(await program.valid(randomUUID()), false);
    await db.transaction((tx) => attributeReferral(tx, owner.id, code));
    assert.equal((await program.status(owner.id)).signups, 0);
    const auth = authStore(db, 'synthetic-referral-auth-secret');
    const intent = await auth.beginEmail('new@example.test');
    const token = await auth.verifyCode(
      intent.id,
      'new@example.test',
      intent.code,
      code,
    );
    assert.ok(token);
    const session = await auth.readSession(token);
    assert.ok(session);
    const revisit = await auth.beginEmail('new@example.test');
    assert.ok(await auth.verifyLink(revisit.link, competing.code));
    assert.equal((await program.status(owner.id)).signups, 1);
    assert.equal((await program.status(other.id)).signups, 0);
    const reward = (invoice: string, refunded = false) =>
      db.transaction((tx) =>
        reconcileReferral(
          tx,
          session.account.id,
          invoice,
          5_000_000_000n,
          refunded,
        ),
      );
    await Promise.all([reward('in_first'), reward('in_first')]);
    await reward('in_renewal');
    assert.equal((await program.status(owner.id)).conversions, 1);
    await Promise.all([reward('in_first', true), reward('in_first', true)]);
    await reward('in_first');
    assert.equal((await program.status(owner.id)).conversions, 0);
    const rows = await db
      .select()
      .from(creditEntries)
      .where(eq(creditEntries.accountId, owner.id));
    assert.deepEqual(
      rows.map(({ kind, amount }) => [kind, Number(amount)]).sort(),
      [
        ['referral', 0.5],
        ['refund', -0.5],
      ],
    );
  },
);
