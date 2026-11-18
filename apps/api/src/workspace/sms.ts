import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Database } from '../db/database';
import { vaultCipher } from './vault';

const connections = pgTable('sms_connections', {
  businessId: uuid('business_id').primaryKey(),
  accountSid: text('account_sid').notNull(),
  numberSid: text('number_sid').notNull(),
  phone: text().notNull(),
  token: text(),
});
const messages = pgTable('sms_messages', {
  id: uuid().defaultRandom().primaryKey(),
  businessId: uuid('business_id').notNull(),
  providerId: text('provider_id'),
  peer: text().notNull(),
  direction: text({ enum: ['inbound', 'outbound'] }).notNull(),
  body: text().notNull(),
  status: text().notNull(),
  optOut: boolean('opt_out'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .default(sql`clock_timestamp()`)
    .notNull(),
});

const phone = z.string().regex(/^\+[1-9]\d{7,14}$/u);
const accountSid = z.string().regex(/^AC[a-f0-9]{32}$/iu);
const numberSid = z.string().regex(/^PN[a-f0-9]{32}$/iu);
const messageSid = z.string().regex(/^(SM|MM)[a-f0-9]{32}$/iu);
export const smsConnectionInput = z.strictObject({
  accountSid,
  numberSid,
  token: z.string().min(24).max(128),
});
export const smsReplyInput = z.strictObject({
  id: z.uuid(),
  recipient: phone,
  body: z.string().trim().min(1).max(1600),
});
const incomingInput = z.object({
  MessageSid: messageSid,
  From: phone,
  To: phone,
  Body: z.string().max(1600),
  OptOutType: z.string().optional(),
});
const state = z.enum([
  'accepted',
  'queued',
  'sending',
  'sent',
  'delivered',
  'undelivered',
  'failed',
  'canceled',
]);
const order: Record<z.infer<typeof state>, number> = {
  accepted: 1,
  queued: 2,
  sending: 3,
  sent: 4,
  delivered: 5,
  undelivered: 5,
  failed: 5,
  canceled: 5,
};

export function validTwilioForm(
  url: string,
  form: URLSearchParams,
  token: string,
  signature: unknown,
) {
  if (typeof signature !== 'string' || !/^[A-Za-z0-9+/]{27}=$/u.test(signature))
    return false;
  const keys = [...form.keys()].sort();
  if (new Set(keys).size !== keys.length) return false;
  const expected = createHmac('sha1', token);
  expected.update(url);
  for (const key of keys) expected.update(key + form.get(key));
  return timingSafeEqual(expected.digest(), Buffer.from(signature, 'base64'));
}

export function workspaceSms(
  db: Database,
  key: string,
  origin: string,
  transport: typeof fetch = fetch,
) {
  const cipher = vaultCipher(key);
  const aad = (id: string) => Buffer.from('brightwork-sms\0' + id);
  const own = (id: string) => eq(connections.businessId, id);
  const callback = (id: string) => origin + '/api/webhooks/twilio/' + id;
  const twilio = (
    sid: string,
    token: string,
    path: string,
    body?: URLSearchParams,
  ) =>
    transport(
      'https://api.twilio.com/2010-04-01/Accounts/' + sid + path + '.json',
      {
        headers: {
          Authorization:
            'Basic ' + Buffer.from(sid + ':' + token).toString('base64'),
        },
        ...(body ? { method: 'POST', body } : {}),
        redirect: 'error',
        signal: AbortSignal.timeout(8_000),
      },
    );
  const ownedMessage = (businessId: string, id: string) =>
    and(
      eq(messages.businessId, businessId),
      eq(messages.id, id),
      eq(messages.direction, 'outbound'),
    );

  return {
    async connection(id: string) {
      const [row] = await db
        .select({
          phone: connections.phone,
          connected: sql<boolean>`${connections.token} is not null`,
        })
        .from(connections)
        .where(own(id));
      return row ? { ...row, webhook: callback(id) } : null;
    },
    async connect(id: string, input: z.infer<typeof smsConnectionInput>) {
      const response = await twilio(
        input.accountSid,
        input.token,
        '/IncomingPhoneNumbers/' + input.numberSid,
      );
      if (!response.ok) {
        await response.body?.cancel();
        return false;
      }
      const record = z
        .object({
          sid: numberSid,
          account_sid: accountSid,
          phone_number: phone,
          capabilities: z.object({ sms: z.literal(true) }),
        })
        .safeParse(await response.json());
      if (
        !record.success ||
        record.data.account_sid !== input.accountSid ||
        record.data.sid !== input.numberSid
      )
        return false;
      const current = {
        businessId: id,
        accountSid: input.accountSid,
        numberSid: input.numberSid,
        phone: record.data.phone_number,
        token: cipher.seal(input.token, aad(id)),
      };
      const [saved] = await db
        .insert(connections)
        .values(current)
        .onConflictDoUpdate({
          target: connections.businessId,
          set: { token: current.token },
          setWhere: sql`${connections.accountSid} = ${current.accountSid}
            and ${connections.numberSid} = ${current.numberSid}
            and ${connections.phone} = ${current.phone}`,
        })
        .returning({ id: connections.businessId });
      return Boolean(saved);
    },
    async disconnect(id: string) {
      await db.update(connections).set({ token: null }).where(own(id));
    },
    list(id: string) {
      return db
        .select({
          id: messages.id,
          peer: messages.peer,
          body: messages.body,
          direction: messages.direction,
          status: messages.status,
          createdAt: messages.createdAt,
        })
        .from(messages)
        .where(eq(messages.businessId, id))
        .orderBy(desc(messages.createdAt), desc(messages.id))
        .limit(100);
    },
    async reply(id: string, input: z.infer<typeof smsReplyInput>) {
      const reservation = await db.transaction(async (tx) => {
        const [connection] = await tx
          .select()
          .from(connections)
          .where(own(id))
          .for('update');
        if (!connection?.token)
          return { error: 'Connect a Twilio number to send a reply.' } as const;
        const [previous] = await tx
          .select()
          .from(messages)
          .where(ownedMessage(id, input.id));
        if (previous)
          return previous.peer === input.recipient &&
            previous.body === input.body
            ? ({ status: previous.status } as const)
            : ({ error: 'This reply was already submitted.' } as const);
        const thread = and(
          eq(messages.businessId, id),
          eq(messages.peer, input.recipient),
          eq(messages.direction, 'inbound'),
        );
        const [received] = await tx
          .select({ id: messages.id })
          .from(messages)
          .where(thread)
          .limit(1);
        if (!received)
          return { error: 'Choose a conversation in this Inbox.' } as const;
        const [consent] = await tx
          .select({ stopped: messages.optOut })
          .from(messages)
          .where(and(thread, isNotNull(messages.optOut)))
          .orderBy(desc(messages.createdAt), desc(messages.id))
          .limit(1);
        if (consent?.stopped)
          return { error: 'This recipient opted out of SMS.' } as const;
        const [saved] = await tx
          .insert(messages)
          .values({
            id: input.id,
            businessId: id,
            peer: input.recipient,
            body: input.body,
            status: 'submitting',
            direction: 'outbound',
          })
          .onConflictDoNothing()
          .returning({ id: messages.id });
        return saved
          ? ({ connection, token: connection.token } as const)
          : ({ error: 'This reply was already submitted.' } as const);
      });
      if (!reservation.connection || !reservation.token) return reservation;
      const { connection, token } = reservation;
      let status = 'needs_review';
      let providerId: string | undefined;
      try {
        const result = await twilio(
          connection.accountSid,
          cipher.open(token, aad(id)),
          '/Messages',
          new URLSearchParams({
            From: connection.phone,
            To: input.recipient,
            Body: input.body,
            StatusCallback: callback(id) + '/' + input.id,
          }),
        );
        if (result.ok) {
          const parsed = z
            .object({ sid: messageSid, status: state })
            .parse(await result.json());
          providerId = parsed.sid;
          status = parsed.status;
        } else {
          await result.body?.cancel();
          if (
            result.status >= 400 &&
            result.status < 500 &&
            ![408, 409, 429].includes(result.status)
          )
            status = 'failed';
        }
      } catch {
        // A lost response may follow a successful submission.
      }
      const scope = ownedMessage(id, input.id);
      await db
        .update(messages)
        .set({ status, ...(providerId ? { providerId } : {}) })
        .where(and(scope, eq(messages.status, 'submitting')));
      const [current] = await db
        .select({ status: messages.status })
        .from(messages)
        .where(scope);
      return { status: current?.status ?? status };
    },
    register(app: FastifyInstance) {
      app.register(async (scope) => {
        scope.addContentTypeParser(
          'application/x-www-form-urlencoded',
          { parseAs: 'string', bodyLimit: 32_000 },
          (_req, body, done) => done(null, new URLSearchParams(String(body))),
        );
        async function webhook(req: FastifyRequest, res: FastifyReply) {
          const params = z
            .object({ business: z.uuid(), outbound: z.uuid().optional() })
            .safeParse(req.params);
          if (
            !params.success ||
            !(req.body instanceof URLSearchParams) ||
            req.url.includes('?')
          )
            return res.code(400).send();
          const { business, outbound } = params.data;
          const form = req.body;
          return db.transaction(async (tx) => {
            const [connection] = await tx
              .select()
              .from(connections)
              .where(own(business))
              .for('update');
            if (
              !connection?.token ||
              form.get('AccountSid') !== connection.accountSid ||
              !validTwilioForm(
                callback(business) + (outbound ? '/' + outbound : ''),
                form,
                cipher.open(connection.token, aad(business)),
                req.headers['x-twilio-signature'],
              )
            )
              return res.code(403).send();
            const values = Object.fromEntries(form);
            if (outbound) {
              const parsed = z
                .object({
                  MessageSid: messageSid,
                  MessageStatus: state,
                  From: phone,
                  To: phone,
                })
                .safeParse(values);
              if (!parsed.success || parsed.data.From !== connection.phone)
                return res.code(400).send();
              const {
                MessageSid: sid,
                MessageStatus: status,
                To: peer,
              } = parsed.data;
              const lower = Object.entries(order)
                .filter(([, rank]) => rank < order[status])
                .map(([key]) => key);
              await tx
                .update(messages)
                .set({ providerId: sid, status })
                .where(
                  and(
                    ownedMessage(business, outbound),
                    eq(messages.peer, peer),
                    or(
                      isNull(messages.providerId),
                      eq(messages.providerId, sid),
                    ),
                    sql`${messages.status} in (${sql.join(
                      ['submitting', 'needs_review', ...lower].map(
                        (value) => sql`${value}`,
                      ),
                      sql`, `,
                    )})`,
                  ),
                );
              return res.code(204).send();
            }
            const parsed = incomingInput.safeParse(values);
            if (!parsed.success || parsed.data.To !== connection.phone)
              return res.code(400).send();
            const message = parsed.data;
            const keyword = (message.OptOutType ?? message.Body)
              .trim()
              .toUpperCase();
            const optOut = [
              'STOP',
              'STOPALL',
              'UNSUBSCRIBE',
              'CANCEL',
              'END',
              'QUIT',
              'REVOKE',
              'OPTOUT',
            ].includes(keyword)
              ? true
              : ['START', 'UNSTOP'].includes(keyword)
                ? false
                : null;
            await tx
              .insert(messages)
              .values({
                businessId: business,
                providerId: message.MessageSid,
                peer: message.From,
                body: message.Body,
                direction: 'inbound',
                status: 'received',
                optOut,
              })
              .onConflictDoNothing();
            return res.type('text/xml').send('<Response/>');
          });
        }
        scope.post('/api/webhooks/twilio/:business', webhook);
        scope.post('/api/webhooks/twilio/:business/:outbound', webhook);
      });
    },
  };
}
