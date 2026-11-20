import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { authEnv } from '../src/auth/config';
import { authProviders } from '../src/auth/providers';
import { businesses } from '../src/db/schema';
import { storeBuyers } from '../src/workspace/store-buyers';

const databaseUrl = process.env.TEST_DATABASE_URL;
const mailpitUrl = process.env.TEST_MAILPIT_URL;

test(
  'store buyer sign-in verifies a code delivered through local Mailpit',
  { skip: !databaseUrl || !mailpitUrl },
  async (t) => {
    assert.ok(databaseUrl && mailpitUrl);
    const mailpitHost = new URL(mailpitUrl).hostname;
    assert.ok(
      ['localhost', '127.0.0.1', '[::1]'].includes(mailpitHost),
      'Mailpit must be local to this integration test',
    );
    const smtpHost = process.env.SMTP_HOST || '127.0.0.1';
    assert.ok(
      ['localhost', '127.0.0.1', '::1'].includes(smtpHost),
      'SMTP must point to the local Mailpit capture',
    );
    const schema = 'store_buyer_mail_' + randomUUID().replaceAll('-', '');
    const admin = postgres(databaseUrl, { max: 1, onnotice: () => {} });
    const connection = postgres(databaseUrl, {
      max: 2,
      onnotice: () => {},
      connection: { search_path: schema },
    });
    const db = drizzle(connection);
    t.after(async () => {
      await connection.end();
      await admin`drop schema if exists ${admin(schema)} cascade`;
      await admin.end();
    });
    await admin`create schema ${admin(schema)}`;
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
      migrationsSchema: schema,
    });
    const [business] = await db
      .insert(businesses)
      .values({ name: 'Local buyer email fixture' })
      .returning();
    assert.ok(business);
    const siteId = randomUUID();
    await connection`insert into workspace_artifacts (id, business_id, kind, title, body)
      values (${siteId}, ${business.id}, 'website', 'Local store', '<main>Shop</main>')`;
    await connection`insert into generated_stores (site_id, first_revision, currency)
      values (${siteId}, 1, 'AUD')`;

    const email = `store-buyer-${randomUUID()}@example.test`;
    const env = authEnv.parse({
      APP_ORIGIN: 'http://127.0.0.1:5173',
      SMTP_HOST: smtpHost,
      SMTP_PORT: process.env.SMTP_PORT || '1025',
      SMTP_SECURE: 'false',
      MAIL_FROM: 'Foundable Local Test <hello@foundable.test>',
    });
    const provider = authProviders(env);
    const buyers = storeBuyers(db, 'mailpit-store-buyer-test-secret');
    const challenge = await buyers.challenge(siteId, email);
    await provider.sendBuyerCode(email, challenge.code, 'Local test store');

    const search = new URL('/api/v1/search', mailpitUrl);
    search.searchParams.set('query', 'to:' + email);
    const searchResponse = await fetch(search);
    assert.equal(searchResponse.status, 200);
    const { messages } = (await searchResponse.json()) as {
      messages: { ID: string }[];
    };
    const sent = messages[0];
    assert.ok(sent, 'Mailpit captured the buyer sign-in email');
    const messageResponse = await fetch(
      new URL('/api/v1/message/' + sent.ID, mailpitUrl),
    );
    assert.equal(messageResponse.status, 200);
    const { Text } = (await messageResponse.json()) as { Text: string };
    assert.ok(
      Text.includes('sign-in code for Local test store is ' + challenge.code),
      'captured email contains the generated code',
    );

    const token = await buyers.verify(siteId, challenge.id, challenge.code);
    assert.ok(token);
    assert.equal(await buyers.buyer(siteId, token), email);
    await buyers.signOutAll(siteId, email);
    assert.equal(await buyers.buyer(siteId, token), null);
  },
);
