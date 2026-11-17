import { and, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Database } from '../db/database';
import { businesses, inboundEmails } from '../db/schema';
import { verifyInboundSignature } from './inbound-signature';

type Config = { domain: string; apiKey: string; secret: string };
const recipientId = z.uuid();
const messageId = z.string().regex(/^<[^<>\s@]{1,400}@[^<>\s@]{1,400}>$/u);
const attachment = z.object({
  id: z.uuid(),
  filename: z
    .string()
    .transform((value) => value.slice(0, 180))
    .nullish(),
});
const metadata = z.object({
  id: z.uuid(),
  size: z.int().nonnegative(),
  download_url: z.url(),
});
const maxAttachmentBytes = 10_000_000;
const delivery = z.object({
  email_id: z.uuid(),
  created_at: z.iso.datetime({ offset: true }),
  from: z.string().trim().min(1).max(1000),
  to: z.array(z.string().max(1000)).max(100),
  subject: z.string().max(4000).default(''),
  message_id: z.string().nullish(),
  attachments: z.array(z.unknown()).default([]),
});
const content = z.object({
  text: z.string().nullish(),
  html: z.string().nullish(),
  message_id: z.string().nullish(),
  headers: z
    .record(z.string(), z.union([z.string(), z.array(z.string())]))
    .catch({})
    .default({}),
});
const summary = {
  id: inboundEmails.id,
  sender: inboundEmails.sender,
  subject: inboundEmails.subject,
  receivedAt: inboundEmails.receivedAt,
  threadId: inboundEmails.threadId,
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
  const body = await readBytes(response, maxResponseBytes);
  return content.parse(JSON.parse(body.toString('utf8')));
}

async function readBytes(response: Response, limit: number) {
  if (
    !response.ok ||
    !response.body ||
    Number(response.headers.get('content-length') ?? '0') > limit
  ) {
    await response.body?.cancel();
    throw new Error('Received data is unavailable');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return Buffer.concat(chunks, size);
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error('Received data exceeded the size limit');
      }
      chunks.push(value);
    }
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
          attachments: inboundEmails.attachments,
          body: inboundEmails.body,
          html: inboundEmails.html,
          messageId: inboundEmails.messageId,
        })
        .from(inboundEmails)
        .where(
          and(eq(inboundEmails.businessId, id), eq(inboundEmails.id, resource)),
        )
        .limit(1);
      return email;
    },
    async download(businessId: string, emailId: string, attachmentId: string) {
      if (!config) return null;
      const [email] = await db
        .select({
          providerId: inboundEmails.providerId,
          attachments: inboundEmails.attachments,
        })
        .from(inboundEmails)
        .where(
          and(
            eq(inboundEmails.businessId, businessId),
            eq(inboundEmails.id, emailId),
          ),
        );
      const file = email?.attachments.find(
        (attachment) => attachment.id === attachmentId,
      );
      if (!email || !file) return null;
      const path = email.providerId + '/attachments/' + file.id;
      const signal = AbortSignal.timeout(10_000);
      const response = await request(
        'https://api.resend.com/emails/receiving/' + path,
        {
          headers: { Authorization: 'Bearer ' + config.apiKey },
          redirect: 'error',
          signal,
        },
      );
      if (response.status === 404) {
        await response.body?.cancel();
        return null;
      }
      const details = metadata.parse(
        JSON.parse((await readBytes(response, 16_384)).toString('utf8')),
      );
      if (details.id !== file.id || details.size > maxAttachmentBytes)
        return null;
      const url = new URL(details.download_url);
      if (
        url.origin !== 'https://inbound-cdn.resend.com' ||
        url.username ||
        url.password
      )
        return null;
      const content = await request(url, { redirect: 'error', signal });
      return {
        filename: file.filename,
        body: await readBytes(content, maxAttachmentBytes),
      };
    },
    thread: (id: string, thread: string) =>
      db
        .select(summary)
        .from(inboundEmails)
        .where(
          and(
            eq(inboundEmails.businessId, id),
            eq(inboundEmails.threadId, thread),
          ),
        )
        .orderBy(desc(inboundEmails.receivedAt), desc(inboundEmails.id))
        .limit(50),
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
            const id = messageId.safeParse(
              message.message_id ?? email.message_id,
            );
            const references = Object.entries(message.headers)
              .filter(([key]) => /^(references|in-reply-to)$/iu.test(key))
              .flatMap(([, value]) =>
                [value]
                  .flat()
                  .flatMap((text) => text.match(/<[^<>\s]+>/gu) ?? []),
              )
              .filter((value) => messageId.safeParse(value).success)
              .slice(-32);
            const parents = references.length
              ? await db
                  .select({
                    businessId: inboundEmails.businessId,
                    threadId: inboundEmails.threadId,
                  })
                  .from(inboundEmails)
                  .where(
                    and(
                      inArray(inboundEmails.businessId, remaining),
                      inArray(inboundEmails.messageId, references),
                    ),
                  )
                  .orderBy(
                    desc(inboundEmails.receivedAt),
                    desc(inboundEmails.id),
                  )
              : [];
            const files = new Map<string, string>();
            for (const value of email.attachments.slice(0, 50)) {
              const parsed = attachment.safeParse(value);
              if (parsed.success)
                files.set(
                  parsed.data.id,
                  parsed.data.filename?.trim() || 'Attachment',
                );
            }
            const attachments = [...files].map(([id, filename]) => ({
              id,
              filename,
            }));
            await db
              .insert(inboundEmails)
              .values(
                remaining.map((businessId) => {
                  const parent = parents.find(
                    (row) => row.businessId === businessId,
                  );
                  return {
                    businessId,
                    ...(parent ? { threadId: parent.threadId } : {}),
                    messageId: id.success ? id.data : null,
                    providerId: email.email_id,
                    sender: email.from,
                    attachments,
                    subject: email.subject,
                    body: message.text?.slice(0, maxStoredCharacters) ?? null,
                    html: message.html?.slice(0, maxStoredCharacters) ?? null,
                    receivedAt: new Date(email.created_at),
                  };
                }),
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
