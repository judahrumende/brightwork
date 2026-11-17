import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { bigint, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { Database } from '../db/database';
import { artifacts, visitDays } from '../db/schema';

const events = pgTable('website_visitor_events', {
  id: bigint({ mode: 'bigint' }).primaryKey().generatedByDefaultAsIdentity(),
  artifactId: uuid('artifact_id')
    .notNull()
    .references(() => artifacts.id, { onDelete: 'cascade' }),
  sessionId: uuid('session_id').notNull(),
  viewedAt: timestamp('viewed_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  page: text().notNull(),
  sourceHost: text('source_host'),
});

type Breakdown = { label: string; count: number };
type VisitorReport = {
  visits: number;
  measuredViews: number;
  singlePageVisits: number;
  averageDurationSeconds: number;
  sources: Breakdown[];
  pages: Breakdown[];
};

export function visitorRepository(db: Database) {
  return {
    async record(
      artifactId: string,
      sessionId: string,
      page: string,
      sourceHost: string | null,
      now = new Date(),
    ) {
      const day = now.toISOString().slice(0, 10);
      await db.transaction(async (tx) => {
        await tx
          .insert(events)
          .values({ artifactId, sessionId, page, sourceHost, viewedAt: now });
        await tx
          .insert(visitDays)
          .values({ artifactId, day, views: 1 })
          .onConflictDoUpdate({
            target: [visitDays.artifactId, visitDays.day],
            set: { views: sql`${visitDays.views} + 1` },
          });
      });
    },
    async report(
      businessId: string,
      from: Date,
      to: Date,
    ): Promise<VisitorReport> {
      const scope = and(
        eq(artifacts.businessId, businessId),
        gte(events.viewedAt, from),
        lt(events.viewedAt, to),
      );
      const [row] = await db.execute<VisitorReport>(sql`
        with filtered as (
          select ${events.id} id, ${events.artifactId} artifact_id, ${events.sessionId} session_id,
                 ${events.viewedAt} viewed_at, ${events.page} page, ${events.sourceHost} source_host
          from ${events}
          inner join ${artifacts} on ${artifacts.id} = ${events.artifactId}
          where ${scope}
        ),
        sessions as (
          select count(*) as views, extract(epoch from (max(viewed_at) - min(viewed_at))) duration,
                 (array_agg(source_host order by viewed_at, id))[1] as source
          from filtered group by artifact_id, session_id
        ),
        source_counts as (
          select coalesce(source, 'Direct') label, count(*)::int as count
          from sessions group by source order by count desc, label limit 10
        ),
        page_counts as (
          select page label, count(*)::int as count
          from filtered group by page order by count desc, label limit 10
        )
        select count(*)::int as "visits", coalesce(sum(views), 0)::int as "measuredViews",
               count(*) filter (where views = 1)::int as "singlePageVisits",
               coalesce(round(avg(duration)), 0)::int as "averageDurationSeconds",
               (select coalesce(jsonb_agg(source_counts order by count desc, label), '[]'::jsonb) from source_counts) as "sources",
               (select coalesce(jsonb_agg(page_counts order by count desc, label), '[]'::jsonb) from page_counts) as "pages"
        from sessions
      `);
      if (!row) throw new Error('Could not aggregate website visits');
      return row;
    },
  };
}
