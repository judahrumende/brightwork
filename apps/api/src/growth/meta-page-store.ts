import { timingSafeEqual } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Database } from '../db/database';
import { vaultCipher } from '../workspace/vault';
import { readPageCommentChanges, verifyMetaWebhook } from './meta-page-webhook';
import { metaPage } from './providers';

const connections = pgTable('meta_page_connections', {
  businessId: uuid('business_id').primaryKey(),
  pageId: text('page_id').notNull(),
  name: text().notNull(),
  token: text(),
});
const comments = pgTable('meta_page_comments', {
  businessId: uuid('business_id').notNull(),
  id: text().notNull(),
  postId: text('post_id').notNull(),
  parentId: text('parent_id').notNull(),
  body: text(),
  ownPage: boolean('own_page').notNull(),
  hidden: boolean().notNull(),
  removed: boolean().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});
const replies = pgTable('meta_page_replies', {
  businessId: uuid('business_id').notNull(),
  id: uuid().notNull(),
  commentId: text('comment_id').notNull(),
  body: text().notNull(),
  status: text().notNull().default('sending'),
  providerId: text('provider_id'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const pageConnectionInput = z.strictObject({
  pageId: z.string().regex(/^\d{1,40}$/u),
  token: z.string().trim().min(10).max(4096),
});
export const pageReplyInput = z.strictObject({
  id: z.uuid(),
  commentId: z.string().regex(/^\d{1,40}(?:_\d{1,40})?$/u),
  body: z.string().trim().min(1).max(4000),
});

export function metaPageReads(db: Database) {
  return {
    async connection(id: string) {
      const [row] = await db
        .select({
          pageId: connections.pageId,
          name: connections.name,
          connected: sql<boolean>`${connections.token} is not null`,
        })
        .from(connections)
        .where(eq(connections.businessId, id));
      return row ?? null;
    },
    async replies(id: string, limit = 100, status?: string) {
      return db
        .select({
          id: replies.id,
          commentId: replies.commentId,
          body: replies.body,
          status: replies.status,
          providerId: replies.providerId,
          createdAt: replies.createdAt,
        })
        .from(replies)
        .where(
          and(
            eq(replies.businessId, id),
            status ? eq(replies.status, status) : undefined,
          ),
        )
        .orderBy(desc(replies.createdAt), desc(replies.id))
        .limit(limit);
    },
  };
}

export function workspaceMetaPages(
  db: Database,
  config: {
    vaultKey: string;
    appSecret: string;
    verifyToken: string;
  },
  transport: typeof fetch = fetch,
) {
  const reads = metaPageReads(db);
  const cipher = vaultCipher(config.vaultKey);
  const ownsPage = (id: string) => eq(connections.businessId, id);
  const context = (id: string) => Buffer.from('meta-page\0' + id);
  const providerFor = (row: typeof connections.$inferSelect) =>
    row.token
      ? metaPage(
          row.pageId,
          cipher.open(row.token, context(row.businessId)),
          transport,
        )
      : null;
  const readConnection = async (id: string) =>
    (await db.select().from(connections).where(ownsPage(id)))[0];
  return {
    connection: reads.connection,
    async provider(id: string) {
      const row = await readConnection(id);
      return row ? providerFor(row) : undefined;
    },
    async connect(id: string, input: z.infer<typeof pageConnectionInput>) {
      const provider = metaPage(input.pageId, input.token, transport);
      const profile = await provider.verify();
      if (!profile) return false;
      return db.transaction(async (tx) => {
        await tx
          .insert(connections)
          .values({ businessId: id, pageId: profile.id, name: profile.name })
          .onConflictDoNothing();
        const [record] = await tx
          .select()
          .from(connections)
          .where(ownsPage(id))
          .for('update');
        if (!record || record.pageId !== profile.id) return false;
        await provider.subscribeToFeed();
        await tx
          .update(connections)
          .set({
            name: profile.name,
            token: cipher.seal(input.token, context(id)),
          })
          .where(ownsPage(id));
        return true;
      });
    },
    async disconnect(id: string) {
      await db.update(connections).set({ token: null }).where(ownsPage(id));
    },
    async threads(id: string) {
      const [received, sent] = await Promise.all([
        db
          .select()
          .from(comments)
          .where(
            and(
              eq(comments.businessId, id),
              eq(comments.removed, false),
              eq(comments.hidden, false),
            ),
          )
          .orderBy(desc(comments.updatedAt))
          .limit(100),
        reads.replies(id),
      ]);
      return {
        comments: received,
        replies: sent.map((reply) => ({ businessId: id, ...reply })),
      };
    },
    async reply(id: string, input: z.infer<typeof pageReplyInput>) {
      const replyScope = and(
        eq(replies.businessId, id),
        eq(replies.id, input.id),
      );
      const claim = await db.transaction(async (tx) => {
        const [record] = await tx
          .select()
          .from(connections)
          .where(ownsPage(id))
          .for('update');
        const provider = record && providerFor(record);
        if (!provider)
          return { error: 'Connect a Facebook Page first.' } as const;
        const [existing] = await tx.select().from(replies).where(replyScope);
        if (existing)
          return existing.commentId === input.commentId &&
            existing.body === input.body
            ? ({
                status: existing.status,
                providerId: existing.providerId,
              } as const)
            : ({ error: 'This request ID is already in use.' } as const);
        const [target] = await tx
          .select()
          .from(comments)
          .where(
            and(eq(comments.businessId, id), eq(comments.id, input.commentId)),
          );
        if (!target || target.removed || target.hidden || target.ownPage)
          return { error: 'This comment is unavailable for a reply.' } as const;
        await tx.insert(replies).values({ ...input, businessId: id });
        return { provider } as const;
      });
      if (!claim.provider) return claim;
      let providerId: string | null = null;
      try {
        providerId = await claim.provider.reply(input.commentId, input.body);
      } catch {
        // A provider response can be lost after the comment was created.
      }
      const status = providerId ? 'published' : 'needs_review';
      await db.update(replies).set({ status, providerId }).where(replyScope);
      return { status, providerId };
    },
    register(app: FastifyInstance) {
      app.register(async (hooks) => {
        hooks.removeContentTypeParser('application/json');
        hooks.addContentTypeParser(
          'application/json',
          { parseAs: 'buffer' },
          (_req, body, done) => done(null, body),
        );
        const path = '/api/webhooks/meta/pages';
        hooks.get(path, async (req, res) => {
          const query = z
            .object({
              'hub.mode': z.literal('subscribe'),
              'hub.verify_token': z.string().max(4096),
              'hub.challenge': z.string().regex(/^\d{1,64}$/u),
            })
            .safeParse(req.query);
          if (!query.success) return res.code(403).send();
          const token = Buffer.from(query.data['hub.verify_token']);
          const expected = Buffer.from(config.verifyToken);
          if (
            token.length !== expected.length ||
            !timingSafeEqual(token, expected)
          )
            return res.code(403).send();
          return res.type('text/plain').send(query.data['hub.challenge']);
        });
        hooks.post(path, { bodyLimit: 512_000 }, async (req, res) => {
          if (
            !Buffer.isBuffer(req.body) ||
            !verifyMetaWebhook(
              config.appSecret,
              req.body,
              req.headers['x-hub-signature-256'],
            )
          )
            return res.code(403).send();
          let raw: unknown;
          try {
            raw = JSON.parse(req.body.toString('utf8'));
          } catch {
            return res.code(400).send();
          }
          const changes = readPageCommentChanges(raw);
          if (!changes) return res.code(400).send();
          for (const change of changes) {
            await db.transaction(async (tx) => {
              const [record] = await tx
                .select()
                .from(connections)
                .where(eq(connections.pageId, change.pageId))
                .for('update');
              if (!record?.token) return;
              const removed =
                change.verb === 'remove' || change.verb === 'delete';
              const hidden = change.verb === 'hide';
              const row = {
                businessId: record.businessId,
                id: change.id,
                postId: change.postId,
                parentId: change.parentId,
                body: removed ? null : change.body,
                ownPage: change.fromOwnPage,
                updatedAt: change.changedAt,
                removed,
                hidden,
              };
              await tx
                .insert(comments)
                .values(row)
                .onConflictDoUpdate({
                  target: [comments.businessId, comments.id],
                  set: {
                    updatedAt: row.updatedAt,
                    removed: sql`${comments.removed} or ${removed}`,
                    hidden:
                      change.verb === 'hide' || change.verb === 'unhide'
                        ? hidden
                        : sql`${comments.hidden}`,
                    ownPage: sql`${comments.ownPage} or ${row.ownPage}`,
                    body: sql`case when ${comments.removed} or ${removed} then null else coalesce(${row.body}, ${comments.body}) end`,
                  },
                  setWhere: sql`${comments.updatedAt} < excluded.updated_at or
                  (${comments.updatedAt} = excluded.updated_at and ${removed})`,
                });
            });
          }
          return res.code(204).send();
        });
      });
    },
  };
}
