import { and, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Database } from '../db/database';
import { businesses, inboundEmails } from '../db/schema';
import { verifyInboundSignature } from './inbound-signature';

type Config = { domain: string; apiKey: string; secret: string };
const recipientId = z.uuid();
const delivery = z.object({
  email_id: z.uuid(),
  created_at: z.iso.datetime({ offset: true }),
  from: z.string().trim().min(1).max(1000),
  to: z.array(z.string().max(1000)).max(100),
  subject: z.string().max(4000).default(''),
});
const content = z.object({
  text: z.string().nullish(),
  html: z.string().nullish(),
});
const summary = {
  id: inboundEmails.id,
  sender: inboundEmails.sender,
  subject: inboundEmails.subject,
  receivedAt: inboundEmails.receivedAt,
};
const maxResponseBytes = 4_000_000;
const maxStoredCharacters = 200_000;

export function inboundRecipients(recipients: string[], domain: string) {
  const result = new Set<string>();
  for (const recipient of recipients) {
    const normalized = recipient.trim().toLowerCase();
    const mailbox = /^[^<>]*<([^<>]+)>$/u.exec(normalized)?.[1] ?? normalized;
    const [local = '', host, extra] = mailbox.split('@');
    if (
      host !== domain ||
      extra !== undefined ||
      !local.startsWith('workspace-')
    )
      continue;
    const id = recipientId.safeParse(local.slice('workspace-'.length));
    if (id.success) result.add(id.data);
  }
  return [...result];
}

async function receiveContent(
  apiKey: string,
  id: string,
  request: typeof fetch,
) {
  const response = await request(
    `https://api.resend.com/emails/receiving/${id}`,
    {
      headers: { Authorization: `Bearer ${apiKey}` },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`Receiving API returned ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let raw = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxResponseBytes) {
        await reader.cancel();
        throw new Error('Receiving API response exceeded the size limit');
      }
      raw += decoder.decode(value, { stream: true });
    }
    return content.parse(JSON.parse(raw + decoder.decode()));
  } finally {
    reader.releaseLock();
  }
}

export function inboundMail(db: Database, config?: Config, request = fetch) {
  return {
    address: (id: string) =>
      config ? `workspace-${id}@${config.domain}` : null,
    list: (id: string) =>
      db
        .select(summary)
        .from(inboundEmails)
        .where(eq(inboundEmails.businessId, id))
        .orderBy(desc(inboundEmails.receivedAt), desc(inboundEmails.id))
        .limit(50),
    async read(id: string, resource: string) {
      const [email] = await db
        .select({
          ...summary,
          body: inboundEmails.body,
          html: inboundEmails.html,
        })
        .from(inboundEmails)
        .where(
          and(eq(inboundEmails.businessId, id), eq(inboundEmails.id, resource)),
        )
        .limit(1);
      return email;
    },
    register(app: FastifyInstance) {
      if (!config) return;
      app.register(async (hook) => {
        hook.removeContentTypeParser('application/json');
        hook.addContentTypeParser(
          'application/json',
          { parseAs: 'buffer', bodyLimit: 128_000 },
          (_request, raw, done) => done(null, raw),
        );
        hook.post('/api/webhooks/inbound-email', async (incoming, reply) => {
          if (
            !Buffer.isBuffer(incoming.body) ||
            !verifyInboundSignature(
              config.secret,
              incoming.body,
              incoming.headers,
            )
          ) {
            return reply
              .code(401)
              .send({ message: 'Invalid webhook signature.' });
          }
          let event: unknown;
          try {
            event = JSON.parse(incoming.body.toString('utf8'));
          } catch {
            return reply
              .code(400)
              .send({ message: 'Malformed webhook event.' });
          }
          const payload = z
            .object({ type: z.string(), data: z.unknown() })
            .safeParse(event);
          if (!payload.success) {
            return reply
              .code(400)
              .send({ message: 'Malformed webhook event.' });
          }
          if (payload.data.type !== 'email.received') return { received: true };
          const parsed = delivery.safeParse(payload.data.data);
          if (!parsed.success) {
            return reply
              .code(400)
              .send({ message: 'Malformed email delivery.' });
          }
          const email = parsed.data;
          const ids = inboundRecipients(email.to, config.domain);
          if (!ids.length) return { received: true };

          try {
            const tenants = await db
              .select({ id: businesses.id })
              .from(businesses)
              .where(inArray(businesses.id, ids));
            const pendingIds = tenants.map((tenant) => tenant.id);
            if (!pendingIds.length) return { received: true };
            const existing = await db
              .select({ id: inboundEmails.businessId })
              .from(inboundEmails)
              .where(
                and(
                  eq(inboundEmails.providerId, email.email_id),
                  inArray(inboundEmails.businessId, pendingIds),
                ),
              );
            const delivered = new Set(existing.map((row) => row.id));
            const remaining = pendingIds.filter((id) => !delivered.has(id));
            if (!remaining.length) return { received: true };
            const message = await receiveContent(
              config.apiKey,
              email.email_id,
              request,
            );
            await db
              .insert(inboundEmails)
              .values(
                remaining.map((businessId) => ({
                  businessId,
                  providerId: email.email_id,
                  sender: email.from,
                  subject: email.subject,
                  body: message.text?.slice(0, maxStoredCharacters) ?? null,
                  html: message.html?.slice(0, maxStoredCharacters) ?? null,
                  receivedAt: new Date(email.created_at),
                })),
              )
              .onConflictDoNothing({
                target: [inboundEmails.providerId, inboundEmails.businessId],
              });
            return { received: true };
          } catch {
            incoming.log.warn(
              { deliveryId: email.email_id },
              'Inbound email delivery deferred',
            );
            return reply
              .code(503)
              .send({ message: 'Email delivery is temporarily unavailable.' });
          }
        });
      });
    },
  };
}
