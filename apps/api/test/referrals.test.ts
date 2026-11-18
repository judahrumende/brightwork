import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import Fastify from 'fastify';
import postgres from 'postgres';
import { accounts, creditEntries } from '../src/db/schema';
import { stripeBilling } from '../src/workspace/stripe-billing';
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
    const intent = await auth.beginEmail('new@example.test', code);
    const token = await auth.verifyCode(
      intent.id,
      'new@example.test',
      intent.code,
      competing.code,
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
    const signedBuyer = await auth.beginEmail('stripe-referral@example.test');
    const signedToken = await auth.verifyCode(
      signedBuyer.id,
      'stripe-referral@example.test',
      signedBuyer.code,
      code,
    );
    assert.ok(signedToken);
    const signedAccount = await auth.readSession(signedToken);
    assert.ok(signedAccount);
    const secret = 'whsec_referral_fixture';
    let refunded = false;
    let historyReads = 0;
    const stripe = stripeBilling(
      db,
      {
        key: 'sk_test_fixture',
        price: 'price_plan',
        webhook: secret,
        origin: 'https://brightwork.example.test',
        renewalCredits: '0',
        referralCredits: '2',
      },
      async (input) => {
        const path = new URL(String(input));
        const invoice = (id: string, paidAt: number, price = 'price_plan') => ({
          id,
          livemode: false,
          customer: 'cus_referral',
          status: 'paid',
          subscription: 'sub_referral',
          amount_paid: 200,
          status_transitions: { paid_at: paidAt },
          charge: { paid: true, refunded: id === 'in_qualifying' && refunded },
          lines: {
            has_more: false,
            data: [{ id: 'il_fixture', price: { id: price } }],
          },
        });
        if (path.pathname === '/v1/customers')
          return Response.json({ id: 'cus_referral', livemode: false });
        if (path.pathname === '/v1/checkout/sessions')
          return Response.json({
            url: 'https://checkout.stripe.com/c/pay/fixture',
          });
        if (path.pathname === '/v1/subscriptions')
          return Response.json({ data: [] });
        if (path.pathname === '/v1/invoices/in_qualifying')
          return Response.json(invoice('in_qualifying', 2));
        assert.equal(path.pathname, '/v1/invoices');
        assert.equal(path.searchParams.get('customer'), 'cus_referral');
        historyReads++;
        return Response.json(
          path.searchParams.has('starting_after')
            ? {
                data: [
                  invoice('in_qualifying', 2),
                  invoice('in_otherprice', 1, 'price_other'),
                ],
                has_more: false,
              }
            : { data: [invoice('in_later', 3)], has_more: true },
        );
      },
    );
    await stripe.checkout(
      signedAccount.account.id,
      signedAccount.account.email,
    );
    stripe.register(app);
    function deliver(id: string, type: string, key = secret) {
      const timestamp = Math.floor(Date.now() / 1000);
      const payload = JSON.stringify({
        id,
        type,
        livemode: false,
        data: { object: { customer: 'cus_referral' } },
      });
      const sig = createHmac('sha256', key)
        .update(timestamp + '.' + payload)
        .digest('hex');
      return app.inject({
        url: '/api/webhooks/stripe',
        method: 'POST',
        payload,
        headers: {
          'content-type': 'application/json',
          'stripe-signature': 't=' + timestamp + ',v1=' + sig,
        },
      });
    }
    assert.equal(
      (await deliver('evt_referral', 'invoice.paid', 'incorrect')).statusCode,
      401,
    );
    assert.equal(
      (await deliver('evt_referral', 'invoice.paid')).statusCode,
      200,
    );
    assert.equal(
      (await deliver('evt_referral', 'invoice.paid')).statusCode,
      200,
    );
    assert.equal(historyReads, 2);
    assert.equal((await program.status(owner.id)).conversions, 1);
    refunded = true;
    assert.equal(
      (await deliver('evt_reversal', 'charge.refunded')).statusCode,
      200,
    );
    assert.equal((await program.status(owner.id)).conversions, 0);
    const final = await db
      .select()
      .from(creditEntries)
      .where(eq(creditEntries.accountId, owner.id));
    assert.equal(
      final.find((entry) => entry.operationKey === 'referral:in_qualifying')
        ?.kind,
      'referral',
    );
    assert.equal(
      Number(
        final.find(
          (entry) => entry.operationKey === 'refund:referral:in_qualifying',
        )?.amount,
      ),
      -2,
    );
  },
);
