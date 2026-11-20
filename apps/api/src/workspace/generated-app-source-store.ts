import { and, asc, eq, gte, lt, or, sql } from 'drizzle-orm';
import type { Database } from '../db/database';
import { generatedAppSourceRevisions } from '../db/schema';

const leaseMs = 5 * 60_000;
const maxAttempts = 2;

export function generatedAppSourceStore(db: Database) {
  return {
    async claim() {
      return db.transaction(async (tx) => {
        const now = new Date();
        await tx
          .update(generatedAppSourceRevisions)
          .set({
            buildState: 'failed',
            buildLog: 'Build worker stopped before completing this revision.',
            buildLeaseUntil: null,
            builtAt: now,
          })
          .where(
            and(
              eq(generatedAppSourceRevisions.buildState, 'building'),
              gte(generatedAppSourceRevisions.buildAttempts, maxAttempts),
              lt(generatedAppSourceRevisions.buildLeaseUntil, now),
            ),
          );
        const [candidate] = await tx
          .select()
          .from(generatedAppSourceRevisions)
          .where(
            or(
              eq(generatedAppSourceRevisions.buildState, 'queued'),
              and(
                eq(generatedAppSourceRevisions.buildState, 'building'),
                lt(generatedAppSourceRevisions.buildLeaseUntil, now),
                lt(generatedAppSourceRevisions.buildAttempts, maxAttempts),
              ),
            ),
          )
          .orderBy(asc(generatedAppSourceRevisions.createdAt))
          .limit(1)
          .for('update', { skipLocked: true });
        if (!candidate) return null;
        const [claimed] = await tx
          .update(generatedAppSourceRevisions)
          .set({
            buildState: 'building',
            buildAttempts: sql`${generatedAppSourceRevisions.buildAttempts} + 1`,
            buildLeaseUntil: new Date(Date.now() + leaseMs),
            buildLog: '',
          })
          .where(
            and(
              eq(generatedAppSourceRevisions.siteId, candidate.siteId),
              eq(generatedAppSourceRevisions.revision, candidate.revision),
            ),
          )
          .returning();
        return claimed ?? null;
      });
    },
    async finish(
      siteId: string,
      revision: number,
      result: { passed: boolean; log: string; previewDocument?: string },
    ) {
      if (
        result.passed &&
        (!result.previewDocument ||
          Buffer.byteLength(result.previewDocument, 'utf8') > 1_000_000 ||
          !/^<!doctype html>/iu.test(result.previewDocument))
      )
        throw new Error(
          'A passed app build must include a bounded HTML preview.',
        );
      const [updated] = await db
        .update(generatedAppSourceRevisions)
        .set({
          buildState: result.passed ? 'passed' : 'failed',
          buildLog: result.log.slice(0, 16_000),
          previewDocument: result.passed
            ? (result.previewDocument ?? null)
            : null,
          buildLeaseUntil: null,
          builtAt: new Date(),
        })
        .where(
          and(
            eq(generatedAppSourceRevisions.siteId, siteId),
            eq(generatedAppSourceRevisions.revision, revision),
            eq(generatedAppSourceRevisions.buildState, 'building'),
          ),
        )
        .returning({ siteId: generatedAppSourceRevisions.siteId });
      return Boolean(updated);
    },
  };
}
