import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import Fastify from 'fastify';
import postgres from 'postgres';
import { businesses } from '../src/db/schema';
import { commerceInsights } from '../src/workspace/commerce-insights';

const url = process.env.TEST_DATABASE_URL;
test(
  'Commerce totals isolate currencies, customers and UTC boundaries',
  { skip: !url },
  async (t) => {
    assert.ok(url);
    const schema = 'brightwork_insights_' + randomUUID().replaceAll('-', '');
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

    const sales = [
      [owner.id, 'jpy', 500, 0, 'repeat', '2026-11-18T00:00:00Z'],
      [owner.id, 'jpy', 700, 100, 'repeat', '2026-11-18T23:59:59Z'],
      [owner.id, 'aud', 1000, 250, null, '2026-11-18T05:00:00Z'],
      [owner.id, 'jpy', 900, 0, 'repeat', '2026-11-19T00:00:00Z'],
      [owner.id, 'jpy', 900, 0, 'repeat', '2026-11-17T23:59:59Z'],
      [other.id, 'aud', 6000, 0, 'other', '2026-11-18T10:00:00Z'],
    ] as const;
    for (const [business, currency, gross, refund, customer, time] of sales) {
      await connection`insert into stripe_sales (id, business_id, account_id, title, currency, amount, amount_refunded, customer_key, paid_at)
        values (${randomUUID()}, ${business}, 'acct_Fixture', 'Fixture sale', ${currency}, ${gross}, ${refund}, ${customer}, ${time})`;
    }
    const range = { from: '2026-11-18', through: '2026-11-18' };
    const result = await commerceInsights(db, owner.id, range);
    assert.deepEqual(
      result.revenue.map((row) => [
        row.currency,
        row.sales,
        Number(row.gross),
        Number(row.refunded),
        Number(row.net),
      ]),
      [
        ['AUD', 1, 10, 2.5, 7.5],
        ['JPY', 2, 1200, 100, 1100],
      ],
    );
    assert.deepEqual(result.customers, {
      identified: 1,
      repeat: 1,
      unattributed: 1,
    });
    const separate = await commerceInsights(db, other.id, range);
    assert.equal(Number(separate.revenue[0]?.gross), 60);
  },
);
