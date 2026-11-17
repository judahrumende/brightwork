import { publishWebsite } from './publish-website';
import { upcomingOccurrences } from './recurrence';
import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  gt,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import type { Database } from '../db/database';
import {
  agentTurns,
  artifacts,
  businesses,
  businessRuns,
  calendarEvents,
  chatAttachments,
  members,
  notificationReads,
  outboundEmails,
  publicationRequests,
  publications,
  taskAutomations,
  visitDays,
  websiteVersions,
  workspaceNotifications,
} from '../db/schema';
export type { TurnPart } from '../db/schema';

export const agentQueueName = 'brightwork-agent';
type Turn = typeof agentTurns.$inferSelect;
type Artifact = typeof artifacts.$inferInsert;
type ChatAttachment = Pick<
  typeof chatAttachments.$inferInsert,
  'name' | 'content'
>;
type AttachmentLink = { id: string; name: string };

export function turnSnapshot(row: Turn & { attachments?: AttachmentLink[] }) {
  return {
    id: row.id,
    label: 'Work on your request',
    prompt: row.prompt,
    text: row.answer,
    parts: row.parts,
    status: row.state,
    revision: row.revision,
    usage: row.usage,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(row.attachments?.length ? { attachments: row.attachments } : {}),
  };
}

export function agentStore(db: Database) {
  type Writer = Pick<Database, 'insert'>;
  async function saveWebsiteVersion(
    writer: Writer,
    row: typeof artifacts.$inferSelect,
  ) {
    await writer.insert(websiteVersions).values({
      artifactId: row.id,
      revision: row.revision,
      document: row.body,
      pages: row.pages,
      title: row.title,
    });
  }
  async function insertArtifact(writer: Writer, item: Artifact) {
    const [record] = await writer.insert(artifacts).values(item).returning();
    if (!record) throw new Error('Could not save work');
    return record;
  }
  const websiteScope = (businessId: string, artifactId: string) =>
    and(
      eq(artifacts.id, artifactId),
      eq(artifacts.businessId, businessId),
      eq(artifacts.kind, 'website'),
    );
  const workQuery = () =>
    db
      .select({
        ...getTableColumns(artifacts),
        liveVersionId: publications.id,
        liveDraftRevision: publications.draftRevision,
        publishWithRun: businessRuns.publishWebsites,
        automatic: taskAutomations.enabled,
        nextAutomationAt: taskAutomations.nextAt,
        latestAutomationTurnId: taskAutomations.turnId,
        emailState: outboundEmails.state,
        emailRecipient: outboundEmails.recipient,
        emailNote: outboundEmails.note,
      })
      .from(artifacts)
      .leftJoin(taskAutomations, eq(taskAutomations.taskId, artifacts.id))
      .leftJoin(
        outboundEmails,
        and(
          eq(outboundEmails.artifactId, artifacts.id),
          eq(outboundEmails.revision, artifacts.revision),
        ),
      )
      .leftJoin(agentTurns, eq(agentTurns.id, artifacts.turnId))
      .leftJoin(
        businessRuns,
        and(
          eq(businessRuns.id, agentTurns.runId),
          eq(businessRuns.businessId, artifacts.businessId),
          sql`${businessRuns.state} in ('active', 'paused')`,
        ),
      )
      .leftJoin(
        publications,
        and(
          eq(publications.artifactId, artifacts.id),
          isNull(publications.unpublishedAt),
        ),
      );

  return {
    async searchWork(
      accountId: string,
      currentBusinessId: string,
      query: string,
    ) {
      const pattern = '%' + query.replace(/[\\%_]/gu, '\\$&') + '%';
      return db
        .select({
          id: artifacts.id,
          title: artifacts.title,
          kind: artifacts.kind,
          businessId: businesses.id,
          businessName: businesses.name,
        })
        .from(members)
        .innerJoin(businesses, eq(businesses.id, members.businessId))
        .innerJoin(artifacts, eq(artifacts.businessId, businesses.id))
        .where(
          and(
            eq(members.accountId, accountId),
            ilike(artifacts.title, pattern),
          ),
        )
        .orderBy(
          desc(sql`${businesses.id} = ${currentBusinessId}`),
          desc(artifacts.createdAt),
          desc(artifacts.id),
        )
        .limit(20);
    },
    async membership(accountId: string, businessId: string) {
      const [record] = await db
        .select({ business: businesses, role: members.role })
        .from(members)
        .innerJoin(businesses, eq(businesses.id, members.businessId))
        .where(
          and(
            eq(members.accountId, accountId),
            eq(members.businessId, businessId),
          ),
        );
      return record;
    },
    async addTurn(
      businessId: string,
      creatorId: string,
      prompt: string,
      files: ChatAttachment[] = [],
    ) {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .insert(agentTurns)
          .values({ businessId, creatorId, prompt })
          .returning();
        if (!row) throw new Error('Could not create turn');
        const attachments = files.length
          ? await tx
              .insert(chatAttachments)
              .values(files.map((file) => ({ ...file, turnId: row.id })))
              .returning({ id: chatAttachments.id, name: chatAttachments.name })
          : [];
        return { ...row, attachments };
      });
    },
    async turns(businessId: string, before?: string) {
      const cursor = before
        ? db
            .select({ createdAt: agentTurns.createdAt, id: agentTurns.id })
            .from(agentTurns)
            .where(
              and(
                eq(agentTurns.businessId, businessId),
                eq(agentTurns.id, before),
              ),
            )
        : null;
      const size = 100;
      const rows = await db
        .select({
          ...getTableColumns(agentTurns),
          attachments: sql<
            AttachmentLink[]
          >`coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name, id) from ${chatAttachments} where turn_id = ${agentTurns.id}), '[]'::jsonb)`,
        })
        .from(agentTurns)
        .where(
          and(
            eq(agentTurns.businessId, businessId),
            cursor
              ? sql`(${agentTurns.createdAt}, ${agentTurns.id}) < (${cursor})`
              : undefined,
          ),
        )
        .orderBy(desc(agentTurns.createdAt), desc(agentTurns.id))
        .limit(size + 1);
      const page = rows.slice(0, size);
      return {
        turns: page.map(turnSnapshot).reverse(),
        before: rows.length > size ? (page.at(-1)?.id ?? null) : null,
      };
    },
    async listFiles(businessId: string, query: string) {
      const pattern = '%' + query.replace(/[\\%_]/gu, '\\$&') + '%';
      return db
        .select({
          id: chatAttachments.id,
          name: chatAttachments.name,
          turnId: chatAttachments.turnId,
          createdAt: agentTurns.createdAt,
        })
        .from(chatAttachments)
        .innerJoin(agentTurns, eq(chatAttachments.turnId, agentTurns.id))
        .where(
          and(
            eq(agentTurns.businessId, businessId),
            query
              ? or(
                  ilike(chatAttachments.name, pattern),
                  ilike(chatAttachments.content, pattern),
                )
              : undefined,
          ),
        )
        .orderBy(desc(agentTurns.createdAt), desc(chatAttachments.id))
        .limit(100);
    },
    async attachments(
      businessId: string,
      turnId: string,
      attachmentId?: string,
    ) {
      return db
        .select({
          name: chatAttachments.name,
          content: chatAttachments.content,
        })
        .from(chatAttachments)
        .innerJoin(agentTurns, eq(chatAttachments.turnId, agentTurns.id))
        .where(
          and(
            eq(agentTurns.businessId, businessId),
            eq(agentTurns.id, turnId),
            attachmentId ? eq(chatAttachments.id, attachmentId) : undefined,
          ),
        )
        .orderBy(asc(chatAttachments.name), asc(chatAttachments.id));
    },
    async readTurn(businessId: string, id: string) {
      const [row] = await db
        .select()
        .from(agentTurns)
        .where(
          and(eq(agentTurns.businessId, businessId), eq(agentTurns.id, id)),
        );
      return row;
    },
    async claimTurn(id: string) {
      return db.transaction(async (tx) => {
        const [queued] = await tx
          .select({ runId: agentTurns.runId })
          .from(agentTurns)
          .where(and(eq(agentTurns.id, id), eq(agentTurns.state, 'queued')));
        if (!queued) return null;
        const [automation] = await tx
          .select({
            enabled: taskAutomations.enabled,
            creator: taskAutomations.creatorId,
            business: artifacts.businessId,
          })
          .from(taskAutomations)
          .innerJoin(artifacts, eq(artifacts.id, taskAutomations.taskId))
          .where(eq(taskAutomations.turnId, id))
          .for('no key update', { of: taskAutomations });
        if (automation) {
          if (!automation.enabled || !automation.creator) return null;
          const [member] = await tx
            .select({ role: members.role })
            .from(members)
            .where(
              and(
                eq(members.businessId, automation.business),
                eq(members.accountId, automation.creator),
              ),
            )
            .for('share');
          if (member?.role !== 'owner' && member?.role !== 'admin') return null;
        }
        if (queued.runId) {
          const [run] = await tx
            .select({
              state: businessRuns.state,
              creator: businessRuns.creatorId,
              company: businessRuns.businessId,
            })
            .from(businessRuns)
            .where(eq(businessRuns.id, queued.runId))
            .for('no key update');
          if (run?.state !== 'active' || !run.creator) return null;
          const [member] = await tx
            .select({ role: members.role })
            .from(members)
            .where(
              and(
                eq(members.businessId, run.company),
                eq(members.accountId, run.creator),
              ),
            )
            .for('share');
          if (member?.role !== 'owner' && member?.role !== 'admin') return null;
        }
        const [row] = await tx
          .update(agentTurns)
          .set({
            state: 'running',
            updatedAt: new Date(),
            revision: sql`${agentTurns.revision} + 1`,
          })
          .where(and(eq(agentTurns.id, id), eq(agentTurns.state, 'queued')))
          .returning();
        if (!row) return null;
        const [business] = await tx
          .select()
          .from(businesses)
          .where(eq(businesses.id, row.businessId));
        return business ? { row, business } : null;
      });
    },
    async updateTurn(
      id: string,
      patch: Partial<
        Pick<Turn, 'state' | 'parts' | 'answer' | 'usage' | 'plan'>
      >,
      expected?: Turn['state'],
    ) {
      await db
        .update(agentTurns)
        .set({
          ...patch,
          updatedAt: new Date(),
          revision: sql`${agentTurns.revision} + 1`,
        })
        .where(
          and(
            eq(agentTurns.id, id),
            ne(agentTurns.state, 'completed'),
            ne(agentTurns.state, 'failed'),
            expected ? eq(agentTurns.state, expected) : undefined,
          ),
        );
    },
    async history(businessId: string, exceptId: string) {
      const rows = await db
        .select({ prompt: agentTurns.prompt, answer: agentTurns.answer })
        .from(agentTurns)
        .where(
          and(
            eq(agentTurns.businessId, businessId),
            ne(agentTurns.id, exceptId),
            eq(agentTurns.state, 'completed'),
          ),
        )
        .orderBy(desc(agentTurns.createdAt))
        .limit(12);
      return rows.reverse();
    },
    async saveArtifact(item: Artifact, automaticActor?: string) {
      if (!item.turnId && item.kind !== 'website' && !automaticActor)
        return insertArtifact(db, item);
      return db.transaction(async (tx) => {
        if (item.turnId) {
          const [running] = await tx
            .select({ id: agentTurns.id })
            .from(agentTurns)
            .where(
              and(
                eq(agentTurns.id, item.turnId),
                eq(agentTurns.businessId, item.businessId),
                eq(agentTurns.state, 'running'),
              ),
            )
            .for('no key update');
          if (!running) throw new Error('This turn is no longer running.');
        }
        const record = await insertArtifact(tx, item);
        if (item.kind === 'website') await saveWebsiteVersion(tx, record);
        if (automaticActor && record.kind === 'task' && record.dueAt) {
          await tx.insert(taskAutomations).values({
            taskId: record.id,
            creatorId: automaticActor,
            nextAt: record.dueAt,
          });
        }
        return record;
      });
    },
    async controlTaskAutomation(
      businessId: string,
      taskId: string,
      actorId: string,
      enabled: boolean,
    ) {
      return db.transaction(async (tx) => {
        const [task] = await tx
          .select()
          .from(artifacts)
          .where(
            and(
              eq(artifacts.businessId, businessId),
              eq(artifacts.id, taskId),
              eq(artifacts.kind, 'task'),
            ),
          )
          .for('no key update');
        if (!task?.dueAt || (enabled && !task.body.trim())) return false;
        const [existing] = await tx
          .select()
          .from(taskAutomations)
          .where(eq(taskAutomations.taskId, taskId))
          .for('no key update');
        if (existing?.enabled === enabled) return true;
        const now = new Date();
        if (enabled) {
          const [next] = upcomingOccurrences(
            task.dueAt,
            task.recurrence,
            task.scheduleTimezone,
            new Date(
              Math.max(
                now.getTime(),
                (existing?.lastScheduledAt?.getTime() ?? 0) + 1,
              ),
            ),
            1,
          );
          if (!next) return false;
          const settings = {
            creatorId: actorId,
            enabled: true,
            nextAt: new Date(next),
            checkAt: now,
          };
          await tx
            .insert(taskAutomations)
            .values({ taskId, ...settings })
            .onConflictDoUpdate({
              target: taskAutomations.taskId,
              set: settings,
            });
        } else if (existing) {
          await tx
            .update(taskAutomations)
            .set({ enabled: false })
            .where(eq(taskAutomations.taskId, taskId));
          if (existing.turnId)
            await tx
              .update(agentTurns)
              .set({
                state: 'failed',
                answer: 'Scheduled execution paused before the turn started.',
                updatedAt: now,
                revision: sql`${agentTurns.revision} + 1`,
              })
              .where(
                and(
                  eq(agentTurns.id, existing.turnId),
                  eq(agentTurns.state, 'queued'),
                ),
              );
        }
        return true;
      });
    },
    async listArtifacts(businessId: string) {
      return workQuery()
        .where(eq(artifacts.businessId, businessId))
        .orderBy(desc(artifacts.createdAt))
        .limit(200);
    },
    async workItem(businessId: string, id: string) {
      const [item] = await workQuery()
        .where(and(eq(artifacts.businessId, businessId), eq(artifacts.id, id)))
        .limit(1);
      return item;
    },
    async workSummary(businessId: string) {
      return db
        .select({
          id: artifacts.id,
          kind: artifacts.kind,
          title: artifacts.title,
          state: artifacts.state,
          revision: artifacts.revision,
          answered: sql<boolean>`${artifacts.answer} is not null`,
          inRun: sql<boolean>`${businessRuns.id} is not null`,
        })
        .from(artifacts)
        .leftJoin(agentTurns, eq(agentTurns.id, artifacts.turnId))
        .leftJoin(
          businessRuns,
          and(
            eq(businessRuns.id, agentTurns.runId),
            eq(businessRuns.businessId, artifacts.businessId),
            inArray(businessRuns.state, ['active', 'paused']),
          ),
        )
        .where(eq(artifacts.businessId, businessId))
        .orderBy(desc(artifacts.createdAt), desc(artifacts.id))
        .limit(200);
    },
    async scheduledTasks(businessId: string, from: Date, to: Date) {
      return db
        .select({
          id: artifacts.id,
          title: artifacts.title,
          dueAt: artifacts.dueAt,
          recurrence: artifacts.recurrence,
          timezone: artifacts.scheduleTimezone,
        })
        .from(artifacts)
        .where(
          and(
            eq(artifacts.businessId, businessId),
            eq(artifacts.kind, 'task'),
            lt(artifacts.dueAt, to),
            or(ne(artifacts.recurrence, 'once'), gte(artifacts.dueAt, from)),
          ),
        )
        .orderBy(asc(artifacts.dueAt), asc(artifacts.id))
        .limit(501);
    },
    async listCalendarEvents(
      businessId: string,
      from: Date,
      to: Date,
      limit: number,
    ) {
      return db
        .select()
        .from(calendarEvents)
        .where(
          and(
            eq(calendarEvents.businessId, businessId),
            lt(calendarEvents.startsAt, to),
            gt(calendarEvents.endsAt, from),
          ),
        )
        .orderBy(asc(calendarEvents.startsAt), asc(calendarEvents.id))
        .limit(limit);
    },
    async createCalendarEvent(input: typeof calendarEvents.$inferInsert) {
      const [event] = await db.insert(calendarEvents).values(input).returning();
      return event;
    },
    async updateCalendarEvent(
      businessId: string,
      id: string,
      patch: Omit<typeof calendarEvents.$inferInsert, 'id' | 'businessId'>,
    ) {
      const [event] = await db
        .update(calendarEvents)
        .set(patch)
        .where(
          and(
            eq(calendarEvents.businessId, businessId),
            eq(calendarEvents.id, id),
          ),
        )
        .returning();
      return event;
    },
    async removeCalendarEvent(businessId: string, id: string) {
      const [event] = await db
        .delete(calendarEvents)
        .where(
          and(
            eq(calendarEvents.businessId, businessId),
            eq(calendarEvents.id, id),
          ),
        )
        .returning({ id: calendarEvents.id });
      return event;
    },
    async markNotifications(
      accountId: string,
      businessId: string,
      keys: string[] | null,
    ) {
      if (keys?.length === 0) return;
      const rows = workspaceNotifications;
      const selected = keys ? inArray(rows.key, keys) : isNull(rows.resolvedAt);
      await db.execute(sql`
        insert into ${notificationReads} (account_id, business_id, key)
        select ${accountId}::uuid, ${rows.businessId}, ${rows.key} from ${rows}
        where ${eq(rows.businessId, businessId)} and ${selected}
        on conflict do nothing
      `);
    },
    async notificationHistory(
      accountId: string,
      businessId: string,
      before?: number,
    ) {
      const rows = workspaceNotifications;
      const readForAccount = and(
        eq(notificationReads.accountId, accountId),
        eq(notificationReads.businessId, rows.businessId),
        eq(notificationReads.key, rows.key),
      );
      const owned = eq(rows.businessId, businessId);
      const limit = 50;
      const [items, counts] = await Promise.all([
        db
          .select({
            id: rows.id,
            artifactId: rows.artifactId,
            kind: artifacts.kind,
            key: rows.key,
            title: rows.title,
            createdAt: rows.createdAt,
            resolvedAt: rows.resolvedAt,
            readAt: notificationReads.readAt,
          })
          .from(rows)
          .innerJoin(artifacts, eq(artifacts.id, rows.artifactId))
          .leftJoin(notificationReads, readForAccount)
          .where(and(owned, before ? lt(rows.id, before) : undefined))
          .orderBy(desc(rows.id))
          .limit(limit + 1),
        db
          .select({ total: count() })
          .from(rows)
          .leftJoin(notificationReads, readForAccount)
          .where(
            and(
              owned,
              isNull(rows.resolvedAt),
              isNull(notificationReads.readAt),
            ),
          ),
      ]);
      return {
        items: items.slice(0, limit),
        before: items.length > limit ? (items[limit - 1]?.id ?? null) : null,
        unread: counts[0]?.total ?? 0,
      };
    },
    async readNotifications(accountId: string, businessId: string) {
      return db
        .select({
          key: notificationReads.key,
          readAt: notificationReads.readAt,
        })
        .from(notificationReads)
        .where(
          and(
            eq(notificationReads.accountId, accountId),
            eq(notificationReads.businessId, businessId),
          ),
        )
        .orderBy(desc(notificationReads.readAt))
        .limit(500);
    },
    async answerQuestion(businessId: string, id: string, answer: string) {
      const [row] = await db
        .update(artifacts)
        .set({ answer, answeredAt: new Date() })
        .where(
          and(
            eq(artifacts.businessId, businessId),
            eq(artifacts.id, id),
            eq(artifacts.kind, 'question'),
            isNull(artifacts.answer),
          ),
        )
        .returning();
      return row;
    },
    async editWebsite(
      businessId: string,
      id: string,
      revision: number,
      title: string,
      body: string,
      pages?: Artifact['pages'],
    ) {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .update(artifacts)
          .set({
            title,
            body,
            pages,
            state: 'pending',
            revision: sql`${artifacts.revision} + 1`,
          })
          .where(
            and(websiteScope(businessId, id), eq(artifacts.revision, revision)),
          )
          .returning();
        if (row) await saveWebsiteVersion(tx, row);
        return row;
      });
    },
    async websiteHistory(businessId: string, id: string) {
      return db
        .select({
          id: websiteVersions.id,
          revision: websiteVersions.revision,
          title: websiteVersions.title,
          savedAt: websiteVersions.savedAt,
          bookmarked: websiteVersions.bookmarked,
        })
        .from(websiteVersions)
        .innerJoin(artifacts, eq(artifacts.id, websiteVersions.artifactId))
        .where(websiteScope(businessId, id))
        .orderBy(desc(websiteVersions.revision))
        .limit(100);
    },
    async websiteVersion(businessId: string, id: string, versionId: string) {
      const [row] = await db
        .select(getTableColumns(websiteVersions))
        .from(websiteVersions)
        .innerJoin(artifacts, eq(artifacts.id, websiteVersions.artifactId))
        .where(
          and(websiteScope(businessId, id), eq(websiteVersions.id, versionId)),
        );
      return row;
    },
    async bookmarkVersion(
      businessId: string,
      id: string,
      versionId: string,
      bookmarked: boolean,
    ) {
      const [row] = await db
        .update(websiteVersions)
        .set({ bookmarked })
        .from(artifacts)
        .where(
          and(
            websiteScope(businessId, id),
            eq(websiteVersions.artifactId, artifacts.id),
            eq(websiteVersions.id, versionId),
          ),
        )
        .returning({ id: websiteVersions.id });
      return row;
    },
    async publish(
      businessId: string,
      id: string,
      revision: number,
      enabled: boolean,
    ) {
      return db.transaction((tx) =>
        publishWebsite(tx, businessId, id, revision, enabled),
      );
    },
    async deployments(businessId: string, id: string) {
      return db
        .select({
          id: publications.id,
          revision: publications.draftRevision,
          publishedAt: publications.publishedAt,
          unpublishedAt: publications.unpublishedAt,
          rollbackSourceId: publications.rollbackSourceId,
        })
        .from(publications)
        .innerJoin(artifacts, eq(artifacts.id, publications.artifactId))
        .where(websiteScope(businessId, id))
        .orderBy(desc(publications.publishedAt), desc(publications.id))
        .limit(100);
    },
    async liveDeployment(businessId: string, id: string, deploymentId: string) {
      const [row] = await db
        .select({
          id: artifacts.id,
          html: publications.document,
          pages: publications.pages,
          revision: publications.draftRevision,
        })
        .from(publications)
        .innerJoin(artifacts, eq(artifacts.id, publications.artifactId))
        .where(
          and(
            websiteScope(businessId, id),
            eq(publications.id, deploymentId),
            isNull(publications.unpublishedAt),
          ),
        );
      return row;
    },
    async rollbackDeployment(
      businessId: string,
      id: string,
      source: string,
      expectedLive: string | null,
    ) {
      return db.transaction(async (tx) => {
        const [site] = await tx
          .select({ id: artifacts.id })
          .from(artifacts)
          .where(websiteScope(businessId, id))
          .for('update');
        if (!site) return null;
        const [snapshot] = await tx
          .select()
          .from(publications)
          .where(
            and(eq(publications.artifactId, id), eq(publications.id, source)),
          );
        if (!snapshot?.unpublishedAt) return null;
        const active = and(
          eq(publications.artifactId, id),
          isNull(publications.unpublishedAt),
        );
        const [live] = await tx
          .select({ id: publications.id })
          .from(publications)
          .where(active);
        if ((live?.id ?? null) !== expectedLive) return null;
        if (live)
          await tx
            .update(publications)
            .set({ unpublishedAt: new Date() })
            .where(active);
        const [next] = await tx
          .insert(publications)
          .values({
            artifactId: id,
            document: snapshot.document,
            pages: snapshot.pages,
            draftRevision: snapshot.draftRevision,
            rollbackSourceId: snapshot.id,
          })
          .returning({ id: publications.id });
        return next ?? null;
      });
    },
    async published(id: string) {
      const [row] = await db
        .select({ document: publications.document, pages: publications.pages })
        .from(publications)
        .where(
          and(
            eq(publications.artifactId, id),
            isNull(publications.unpublishedAt),
          ),
        );
      return row;
    },
    async visit(id: string) {
      const day = new Date().toISOString().slice(0, 10);
      await db
        .insert(visitDays)
        .values({ artifactId: id, day, views: 1 })
        .onConflictDoUpdate({
          target: [visitDays.artifactId, visitDays.day],
          set: { views: sql`${visitDays.views} + 1` },
        });
    },
    async visitorCounts(businessId: string) {
      const first = new Date();
      first.setUTCDate(first.getUTCDate() - 89);
      return db
        .select({
          day: visitDays.day,
          views: sql`sum(${visitDays.views})`.mapWith(Number),
        })
        .from(visitDays)
        .innerJoin(artifacts, eq(artifacts.id, visitDays.artifactId))
        .where(
          and(
            eq(artifacts.businessId, businessId),
            gte(visitDays.day, first.toISOString().slice(0, 10)),
          ),
        )
        .groupBy(visitDays.day)
        .orderBy(desc(visitDays.day))
        .limit(90);
    },
    async decide(
      businessId: string,
      id: string,
      revision: number,
      approve: boolean,
      actorId: string,
    ) {
      return db.transaction(async (tx) => {
        const [website] = approve
          ? await tx
              .select({ runId: agentTurns.runId })
              .from(artifacts)
              .innerJoin(agentTurns, eq(agentTurns.id, artifacts.turnId))
              .where(websiteScope(businessId, id))
          : [];
        const [run] = website?.runId
          ? await tx
              .select({ id: businessRuns.id })
              .from(businessRuns)
              .where(
                and(
                  eq(businessRuns.id, website.runId),
                  eq(businessRuns.businessId, businessId),
                  eq(businessRuns.publishWebsites, true),
                  sql`${businessRuns.state} in ('active', 'paused')`,
                ),
              )
              .for('no key update')
          : [];
        const [row] = await tx
          .update(artifacts)
          .set({ state: approve ? 'approved' : 'rejected' })
          .where(
            and(
              eq(artifacts.id, id),
              eq(artifacts.businessId, businessId),
              eq(artifacts.state, 'pending'),
              eq(artifacts.revision, revision),
            ),
          )
          .returning();
        if (row && run) {
          await tx
            .insert(publicationRequests)
            .values({ runId: run.id, artifactId: row.id, actorId, revision })
            .onConflictDoNothing();
          await tx
            .update(businessRuns)
            .set({ nextCheckAt: new Date() })
            .where(eq(businessRuns.id, run.id));
        }
        return row;
      });
    },
  };
}
