import { and, asc, eq, lt, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Database } from '../db/database';
import { artifacts, generatedAppJobs as jobs } from '../db/schema';
import type { AppUser } from './generated-app-records';

export const appJobInput = z.strictObject({
  id: z.uuid(),
  collection: z.string().regex(/^[a-z][a-z0-9_-]{0,62}$/u),
  recordId: z.uuid(),
  action: z.string().regex(/^[a-z][a-z0-9_-]{0,62}$/u),
  runAt: z.iso.datetime(),
});
const maxAttempts = 3;
const leaseMs = 60_000;
const maxFutureMs = 30 * 24 * 60 * 60_000;
const scheduled = (input: unknown) => {
  const job = appJobInput.parse(input);
  const runAt = new Date(job.runAt);
  if (
    runAt.getTime() < Date.now() + 5_000 ||
    runAt.getTime() > Date.now() + maxFutureMs
  )
    throw new Error(
      'Schedule jobs at least five seconds and no more than 30 days ahead.',
    );
  return { ...job, runAt };
};

export type AppJobClaim = {
  businessId: string;
  siteId: string;
  environment: 'live' | 'preview';
  dataRevision: number;
  schemaRevision: number;
  id: string;
  actorId: string;
  actorEmail: string;
  collection: string;
  recordId: string;
  action: string;
  attempts: number;
  lease: string;
};

export function generatedAppJobs(db: Database) {
  return {
    async enqueue(
      businessId: string | null,
      siteId: string,
      user: AppUser,
      input: unknown,
      environment: 'live' | 'preview' = 'live',
      dataRevision = 0,
    ) {
      const parsed = scheduled(input);
      return db.transaction(async (tx) => {
        const [site] = await tx.execute<{
          revision: number;
          businessId: string;
        }>(sql`
          select site.revision, site.business_id as "businessId" from workspace_artifacts site
          where site.id = ${siteId}::uuid and (${businessId}::uuid is null or site.business_id = ${businessId}::uuid)
            and site.kind = 'website' for update`);
        if (!site) return null;
        const [revision] = await tx.execute<{ revision: number }>(
          environment === 'live'
            ? sql`select draft_revision as revision from website_publications
                where artifact_id = ${siteId}::uuid and unpublished_at is null and runtime_mode = 'app'`
            : sql`select version.revision from website_versions version
                where version.artifact_id = ${siteId}::uuid and version.revision = ${dataRevision}
                  and version.runtime_mode = 'app' and ${site.revision} = ${dataRevision}`,
        );
        if (!revision) return null;
        const [existing] = await tx
          .select()
          .from(jobs)
          .where(
            and(
              eq(jobs.siteId, siteId),
              eq(jobs.environment, environment),
              eq(jobs.dataRevision, dataRevision),
              eq(jobs.id, parsed.id),
            ),
          );
        if (existing)
          return existing.actorEmail === user.email &&
            existing.collection === parsed.collection &&
            existing.recordId === parsed.recordId &&
            existing.action === parsed.action &&
            existing.runAt.getTime() === parsed.runAt.getTime()
            ? existing
            : null;
        const [quota] = await tx.execute<{ count: number }>(sql`
          select count(*)::int as count from generated_app_jobs
          where site_id = ${siteId}::uuid and environment = ${environment}
            and data_revision = ${dataRevision} and actor_email = ${user.email}
            and state in ('queued', 'running')`);
        if (!quota || quota.count >= 100) return null;
        const [created] = await tx
          .insert(jobs)
          .values({
            siteId,
            environment,
            dataRevision,
            schemaRevision: revision.revision,
            id: parsed.id,
            actorId: user.id,
            actorEmail: user.email,
            collection: parsed.collection,
            recordId: parsed.recordId,
            action: parsed.action,
            runAt: parsed.runAt,
          })
          .returning();
        return created ?? null;
      });
    },
    async listForUser(
      siteId: string,
      user: AppUser,
      environment: 'live' | 'preview' = 'live',
      dataRevision = 0,
    ) {
      return db
        .select({
          id: jobs.id,
          collection: jobs.collection,
          recordId: jobs.recordId,
          action: jobs.action,
          runAt: jobs.runAt,
          state: jobs.state,
          attempts: jobs.attempts,
          lastError: jobs.lastError,
          createdAt: jobs.createdAt,
          completedAt: jobs.completedAt,
        })
        .from(jobs)
        .where(
          and(
            eq(jobs.siteId, siteId),
            eq(jobs.environment, environment),
            eq(jobs.dataRevision, dataRevision),
            user.role === 'admin' ? undefined : eq(jobs.actorEmail, user.email),
          ),
        )
        .orderBy(asc(jobs.runAt), asc(jobs.createdAt))
        .limit(100);
    },
    async listForWorkspace(
      businessId: string,
      siteId: string,
      cursor?: { runAt: string; createdAt: string; id: string },
      limit = 100,
      includeCursor = false,
    ) {
      return db.execute(sql`
        select job.id, job.actor_email as "actorEmail", job.collection,
          job.record_id as "recordId", job.action, job.run_at as "runAt",
          job.state, job.attempts, job.last_error as "lastError",
          job.created_at as "createdAt", job.completed_at as "completedAt"
          ${
            includeCursor
              ? sql`, to_char(job.run_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "cursorRunAt",
            to_char(job.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "cursorCreatedAt"`
              : sql.empty()
          }
        from generated_app_jobs job
        join workspace_artifacts site on site.id = job.site_id
        where site.business_id = ${businessId}::uuid and site.id = ${siteId}::uuid
          and site.kind = 'website' and job.environment = 'live' and job.data_revision = 0
          and (${cursor?.runAt ?? null}::timestamptz is null or
            job.run_at > ${cursor?.runAt ?? null}::timestamptz or
            (job.run_at = ${cursor?.runAt ?? null}::timestamptz and
              (job.created_at, job.id) < (${cursor?.createdAt ?? null}::timestamptz, ${cursor?.id ?? null}::uuid)))
        order by job.run_at, job.created_at desc, job.id desc
        limit ${Math.min(Math.max(limit, 1), 101)}`);
    },
    async claim(now = new Date()): Promise<AppJobClaim | null> {
      return db.transaction(async (tx) => {
        await tx
          .update(jobs)
          .set({
            state: 'failed',
            lease: null,
            leaseUntil: null,
            lastError: 'Job worker lease expired after three attempts.',
            completedAt: now,
          })
          .where(
            and(
              eq(jobs.state, 'running'),
              eq(jobs.attempts, maxAttempts),
              lt(jobs.leaseUntil, now),
            ),
          );
        const [candidate] = await tx
          .select({ job: jobs, businessId: artifacts.businessId })
          .from(jobs)
          .innerJoin(artifacts, eq(artifacts.id, jobs.siteId))
          .where(
            or(
              and(eq(jobs.state, 'queued'), lt(jobs.runAt, now)),
              and(
                eq(jobs.state, 'running'),
                lt(jobs.leaseUntil, now),
                lt(jobs.attempts, maxAttempts),
              ),
            ),
          )
          .orderBy(asc(jobs.runAt), asc(jobs.createdAt))
          .limit(1)
          .for('update', { skipLocked: true });
        if (!candidate) return null;
        const lease = randomUUID();
        const [claimed] = await tx
          .update(jobs)
          .set({
            state: 'running',
            attempts: sql`${jobs.attempts} + 1`,
            lease,
            leaseUntil: new Date(now.getTime() + leaseMs),
          })
          .where(
            and(
              eq(jobs.siteId, candidate.job.siteId),
              eq(jobs.environment, candidate.job.environment),
              eq(jobs.dataRevision, candidate.job.dataRevision),
              eq(jobs.id, candidate.job.id),
            ),
          )
          .returning({ attempts: jobs.attempts });
        return claimed
          ? {
              businessId: candidate.businessId,
              siteId: candidate.job.siteId,
              environment: candidate.job.environment,
              dataRevision: candidate.job.dataRevision,
              schemaRevision: candidate.job.schemaRevision,
              id: candidate.job.id,
              actorId: candidate.job.actorId,
              actorEmail: candidate.job.actorEmail,
              collection: candidate.job.collection,
              recordId: candidate.job.recordId,
              action: candidate.job.action,
              attempts: claimed.attempts,
              lease,
            }
          : null;
      });
    },
    async current(claim: AppJobClaim) {
      const [active] = await db.execute(sql`
        select 1 from workspace_artifacts site
        where site.id = ${claim.siteId}::uuid and site.business_id = ${claim.businessId}::uuid
          and site.kind = 'website' and (
            (${claim.environment} = 'live' and exists (
              select 1 from website_publications publication
              where publication.artifact_id = site.id and publication.unpublished_at is null
                and publication.runtime_mode = 'app'
                and publication.draft_revision = ${claim.schemaRevision}
            )) or (${claim.environment} = 'preview' and site.revision = ${claim.schemaRevision}
              and exists (select 1 from website_versions version
                where version.artifact_id = site.id and version.revision = site.revision
                  and version.runtime_mode = 'app')
            )
          )`);
      return Boolean(active);
    },
    async finish(claim: AppJobClaim, error?: string) {
      const [updated] = await db
        .update(jobs)
        .set({
          state: error ? 'failed' : 'succeeded',
          lease: null,
          leaseUntil: null,
          lastError: (error ?? '').slice(0, 1_000),
          completedAt: new Date(),
        })
        .where(
          and(
            eq(jobs.siteId, claim.siteId),
            eq(jobs.environment, claim.environment),
            eq(jobs.dataRevision, claim.dataRevision),
            eq(jobs.id, claim.id),
            eq(jobs.state, 'running'),
            eq(jobs.lease, claim.lease),
          ),
        )
        .returning({ id: jobs.id });
      return Boolean(updated);
    },
    async retry(claim: AppJobClaim) {
      const terminal = claim.attempts >= maxAttempts;
      const [updated] = await db
        .update(jobs)
        .set({
          state: terminal ? 'failed' : 'queued',
          runAt: terminal
            ? new Date()
            : new Date(Date.now() + claim.attempts * 10_000),
          lease: null,
          leaseUntil: null,
          lastError: terminal
            ? 'Background job failed after three attempts.'
            : `Temporary worker failure; retry ${claim.attempts} of ${maxAttempts}.`,
          completedAt: terminal ? new Date() : null,
        })
        .where(
          and(
            eq(jobs.siteId, claim.siteId),
            eq(jobs.environment, claim.environment),
            eq(jobs.dataRevision, claim.dataRevision),
            eq(jobs.id, claim.id),
            eq(jobs.state, 'running'),
            eq(jobs.lease, claim.lease),
          ),
        )
        .returning({ id: jobs.id });
      return Boolean(updated);
    },
    async cancelForUser(
      siteId: string,
      id: string,
      user: AppUser,
      environment: 'live' | 'preview' = 'live',
      dataRevision = 0,
    ) {
      const [cancelled] = await db
        .update(jobs)
        .set({ state: 'cancelled', completedAt: new Date() })
        .where(
          and(
            eq(jobs.siteId, siteId),
            eq(jobs.environment, environment),
            eq(jobs.dataRevision, dataRevision),
            eq(jobs.id, id),
            eq(jobs.state, 'queued'),
            user.role === 'admin' ? undefined : eq(jobs.actorEmail, user.email),
          ),
        )
        .returning({ id: jobs.id });
      return Boolean(cancelled);
    },
    async cancelForWorkspace(businessId: string, siteId: string, id: string) {
      const rows = await db.execute(sql`
        update generated_app_jobs job set state = 'cancelled', completed_at = now()
        where job.site_id = ${siteId}::uuid and job.id = ${id}::uuid
          and job.environment = 'live' and job.data_revision = 0 and job.state = 'queued'
          and exists (select 1 from workspace_artifacts site
            where site.id = job.site_id and site.business_id = ${businessId}::uuid
              and site.kind = 'website') returning job.id`);
      return rows.length > 0;
    },
  };
}
