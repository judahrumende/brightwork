import { and, asc, desc, eq, inArray, isNull, lt, lte, sql } from 'drizzle-orm';
import type { Database } from '../db/database';
import {
  agentTurns,
  artifacts,
  businessRuns,
  members,
  publicationRequests,
  runEvents,
  runSteps,
} from '../db/schema';
import { publishWebsite } from './publish-website';
import { nextRunStep } from './run-policy';
import { runPlan } from './run-plan';

type Run = typeof businessRuns.$inferSelect;
type RunTx = Parameters<Parameters<Database['transaction']>[0]>[0];

export function canLeadRun(role: string) {
  return role === 'owner' || role === 'admin';
}

function summarize(run: Run) {
  return {
    id: run.id,
    goal: run.goal,
    state: run.state,
    creditLimit: run.creditLimit,
    creditsUsed: run.creditsUsed,
    publishWebsites: run.publishWebsites,
    waitingFor: run.waitingFor,
    failure: run.failure,
    createdAt: run.createdAt.toISOString(),
    endedAt: run.endedAt?.toISOString() ?? null,
    pausedAt: run.state === 'paused' ? run.nextCheckAt.toISOString() : null,
  };
}

export function runStore(db: Database) {
  async function update(tx: RunTx, id: string, values: Partial<Run>) {
    await tx.update(businessRuns).set(values).where(eq(businessRuns.id, id));
  }

  return {
    async create(
      businessId: string,
      creatorId: string,
      input: {
        goal: string;
        steps: string[];
        creditLimit: string;
        publishWebsites: boolean;
      },
    ) {
      return db.transaction(async (tx) => {
        const { steps, ...settings } = input;
        const [run] = await tx
          .insert(businessRuns)
          .values({ businessId, creatorId, ...settings })
          .onConflictDoNothing()
          .returning();
        if (!run) return null;
        if (steps.length) {
          await tx.insert(runSteps).values(
            steps.map((instruction, index) => ({
              runId: run.id,
              instruction,
              position: index + 1,
            })),
          );
        } else {
          const [planner] = await tx
            .insert(agentTurns)
            .values({
              businessId,
              creatorId,
              runId: run.id,
              purpose: 'plan',
              prompt: run.goal,
            })
            .returning({ id: agentTurns.id });
          if (!planner) throw new Error('Could not create the planning turn.');
          await tx.insert(runSteps).values({
            runId: run.id,
            position: 1,
            instruction: 'Plan the work for this goal',
            turnId: planner.id,
            attempt: 1,
          });
        }
        return summarize(run);
      });
    },

    async list(businessId: string) {
      const runs = await db
        .select()
        .from(businessRuns)
        .where(eq(businessRuns.businessId, businessId))
        .orderBy(
          sql`case when ${businessRuns.state} in ('active', 'paused') then 0 else 1 end`,
          desc(businessRuns.createdAt),
        )
        .limit(8);
      if (!runs.length) return [];
      const steps = await db
        .select({
          runId: runSteps.runId,
          position: runSteps.position,
          instruction: runSteps.instruction,
          attempt: runSteps.attempt,
          finishedAt: runSteps.completedAt,
          turnId: agentTurns.id,
          status: agentTurns.state,
          answer: agentTurns.answer,
        })
        .from(runSteps)
        .leftJoin(agentTurns, eq(agentTurns.id, runSteps.turnId))
        .where(
          inArray(
            runSteps.runId,
            runs.map((run) => run.id),
          ),
        )
        .orderBy(asc(runSteps.position));
      const publications = await db
        .select({
          id: publicationRequests.id,
          runId: publicationRequests.runId,
          artifactId: publicationRequests.artifactId,
          revision: publicationRequests.revision,
          title: artifacts.title,
          state: publicationRequests.state,
          failure: publicationRequests.failure,
        })
        .from(publicationRequests)
        .innerJoin(artifacts, eq(artifacts.id, publicationRequests.artifactId))
        .where(
          inArray(
            publicationRequests.runId,
            runs.map((run) => run.id),
          ),
        )
        .orderBy(desc(publicationRequests.createdAt));
      return runs.map((run) => ({
        ...summarize(run),
        steps: steps.flatMap(({ runId, finishedAt, ...step }) =>
          runId === run.id
            ? [{ ...step, finishedAt: finishedAt?.toISOString() ?? null }]
            : [],
        ),
        publications: publications.filter((item) => item.runId === run.id),
      }));
    },

    async current(businessId: string) {
      const [run] = await db
        .select()
        .from(businessRuns)
        .where(eq(businessRuns.businessId, businessId))
        .orderBy(
          sql`case when ${businessRuns.state} in ('active', 'paused') then 0 else 1 end`,
          desc(businessRuns.createdAt),
        )
        .limit(1);
      return run ? summarize(run) : null;
    },

    async queue(businessId: string, runId: string) {
      const [run] = await db
        .select({ state: businessRuns.state })
        .from(businessRuns)
        .where(
          and(
            eq(businessRuns.businessId, businessId),
            eq(businessRuns.id, runId),
          ),
        );
      if (!run) return null;
      const [steps, [turn]] = await Promise.all([
        db
          .select({
            position: runSteps.position,
            prompt: runSteps.instruction,
            attempt: runSteps.attempt,
            turnId: runSteps.turnId,
            state: agentTurns.state,
          })
          .from(runSteps)
          .leftJoin(
            agentTurns,
            and(
              eq(agentTurns.id, runSteps.turnId),
              eq(agentTurns.businessId, businessId),
            ),
          )
          .where(and(eq(runSteps.runId, runId), isNull(runSteps.completedAt)))
          .orderBy(asc(runSteps.position)),
        db
          .select()
          .from(agentTurns)
          .where(
            and(
              eq(agentTurns.businessId, businessId),
              eq(agentTurns.runId, runId),
            ),
          )
          .orderBy(
            sql`case when ${agentTurns.state} in ('running', 'queued') then 0 else 1 end`,
            desc(agentTurns.createdAt),
            desc(agentTurns.id),
          )
          .limit(1),
      ]);
      return {
        paused: run.state === 'paused',
        items: ['completed', 'failed'].includes(run.state)
          ? []
          : steps.map(({ state, ...step }) => ({
              id: runId + ':' + step.position,
              ...step,
              status: state ?? 'pending',
            })),
        turn,
      };
    },

    async turns(businessId: string, runId: string, limit: number) {
      const [run] = await db
        .select({ id: businessRuns.id })
        .from(businessRuns)
        .where(
          and(
            eq(businessRuns.businessId, businessId),
            eq(businessRuns.id, runId),
          ),
        );
      if (!run) return null;
      const turns = await db
        .select()
        .from(agentTurns)
        .where(
          and(
            eq(agentTurns.businessId, businessId),
            eq(agentTurns.runId, runId),
          ),
        )
        .orderBy(desc(agentTurns.createdAt), desc(agentTurns.id))
        .limit(limit);
      return turns.reverse();
    },

    async waitingApprovals(businessId: string, runId: string) {
      const ids = {
        emails: [] as string[],
        posts: [] as string[],
        siteChanges: [] as string[],
      };
      const pending = await db
        .select({ id: artifacts.id, kind: artifacts.kind })
        .from(artifacts)
        .innerJoin(agentTurns, eq(artifacts.turnId, agentTurns.id))
        .where(
          and(
            eq(artifacts.businessId, businessId),
            eq(agentTurns.businessId, businessId),
            eq(agentTurns.runId, runId),
            eq(artifacts.state, 'pending'),
            inArray(artifacts.kind, ['website', 'email', 'post']),
          ),
        )
        .orderBy(asc(artifacts.createdAt), asc(artifacts.id));
      for (const item of pending) {
        if (item.kind === 'email') ids.emails.push(item.id);
        if (item.kind === 'post') ids.posts.push(item.id);
        if (item.kind === 'website') ids.siteChanges.push(item.id);
      }
      return {
        ids,
        emails: ids.emails.length,
        posts: ids.posts.length,
        siteChanges: ids.siteChanges.length,
      };
    },

    async questions(businessId: string, runId: string) {
      const questions = await db
        .select({
          id: artifacts.id,
          question: artifacts.title,
          why: artifacts.body,
          askedAt: artifacts.createdAt,
          answer: artifacts.answer,
          answeredAt: artifacts.answeredAt,
        })
        .from(artifacts)
        .innerJoin(agentTurns, eq(artifacts.turnId, agentTurns.id))
        .where(
          and(
            eq(artifacts.businessId, businessId),
            eq(agentTurns.businessId, businessId),
            eq(agentTurns.runId, runId),
            eq(artifacts.kind, 'question'),
          ),
        )
        .orderBy(asc(artifacts.createdAt), asc(artifacts.id));
      return questions.map(({ answer, answeredAt, askedAt, ...question }) => ({
        ...question,
        askedAt: askedAt.toISOString(),
        kind: 'owner',
        instead: '',
        ...(answer !== null && answeredAt
          ? { answer: { text: answer, files: 0, at: answeredAt.toISOString() } }
          : {}),
      }));
    },

    async history(businessId: string, runId: string, before?: number) {
      const [run] = await db
        .select()
        .from(businessRuns)
        .where(
          and(
            eq(businessRuns.id, runId),
            eq(businessRuns.businessId, businessId),
          ),
        );
      if (!run) return null;
      const limit = 50;
      const events = await db
        .select()
        .from(runEvents)
        .where(
          and(
            eq(runEvents.runId, run.id),
            before ? lt(runEvents.id, before) : undefined,
          ),
        )
        .orderBy(desc(runEvents.id))
        .limit(limit + 1);
      return {
        run: summarize(run),
        events: events.slice(0, limit),
        before: events.length > limit ? (events[limit - 1]?.id ?? null) : null,
      };
    },

    async control(businessId: string, id: string, action: 'pause' | 'resume') {
      const [run] = await db
        .update(businessRuns)
        .set({
          state: action === 'pause' ? 'paused' : 'active',
          nextCheckAt: new Date(),
        })
        .where(
          and(
            eq(businessRuns.businessId, businessId),
            eq(businessRuns.id, id),
            eq(businessRuns.state, action === 'pause' ? 'active' : 'paused'),
          ),
        )
        .returning();
      return run ? summarize(run) : null;
    },

    // The current step and its queued turn are a durable dispatch record.
    async advance(now = new Date()) {
      return db.transaction(async (tx) => {
        const [run] = await tx
          .select()
          .from(businessRuns)
          .where(
            and(
              eq(businessRuns.state, 'active'),
              lte(businessRuns.nextCheckAt, now),
            ),
          )
          .orderBy(asc(businessRuns.nextCheckAt), asc(businessRuns.id))
          .limit(1)
          .for('no key update', { skipLocked: true });
        if (!run) return null;
        const finish = async (failure?: string) => {
          await update(tx, run.id, {
            state: failure ? 'failed' : 'completed',
            endedAt: now,
            failure: failure ?? null,
            waitingFor: null,
          });
          return { turnId: null };
        };

        const [member] = run.creatorId
          ? await tx
              .select({ role: members.role })
              .from(members)
              .where(
                and(
                  eq(members.businessId, run.businessId),
                  eq(members.accountId, run.creatorId),
                ),
              )
          : [];
        if (!run.creatorId || !member || !canLeadRun(member.role))
          return finish(
            'The Run creator no longer has permission to lead this Run.',
          );

        const [publication] = await tx
          .select()
          .from(publicationRequests)
          .where(
            and(
              eq(publicationRequests.runId, run.id),
              eq(publicationRequests.state, 'queued'),
            ),
          )
          .orderBy(asc(publicationRequests.createdAt))
          .limit(1);
        if (publication) {
          const [reviewer] = publication.actorId
            ? await tx
                .select({ role: members.role })
                .from(members)
                .where(
                  and(
                    eq(members.businessId, run.businessId),
                    eq(members.accountId, publication.actorId),
                  ),
                )
                .for('share')
            : [];
          const permitted = Boolean(reviewer && canLeadRun(reviewer.role));
          const published =
            permitted &&
            (await publishWebsite(
              tx,
              run.businessId,
              publication.artifactId,
              publication.revision,
              true,
            ));
          await tx
            .update(publicationRequests)
            .set({
              state: published ? 'published' : 'failed',
              finishedAt: now,
              failure: published
                ? null
                : permitted
                  ? 'The approved revision changed before publishing.'
                  : 'The reviewer no longer has permission to publish.',
            })
            .where(eq(publicationRequests.id, publication.id));
          await update(tx, run.id, {
            nextCheckAt: new Date(now.getTime() + 1_000),
            waitingFor: null,
          });
          return { turnId: null };
        }

        const [step] = await tx
          .select()
          .from(runSteps)
          .where(and(eq(runSteps.runId, run.id), isNull(runSteps.completedAt)))
          .orderBy(asc(runSteps.position))
          .limit(1);
        if (!step) return finish();
        const [turn] = step.turnId
          ? await tx
              .select({
                id: agentTurns.id,
                state: agentTurns.state,
                answer: agentTurns.answer,
                updatedAt: agentTurns.updatedAt,
                purpose: agentTurns.purpose,
                plan: agentTurns.plan,
              })
              .from(agentTurns)
              .where(eq(agentTurns.id, step.turnId))
          : [];
        const work =
          turn?.state === 'completed'
            ? await tx
                .select({
                  kind: artifacts.kind,
                  state: artifacts.state,
                  answered: sql<boolean>`${artifacts.answer} is not null`,
                })
                .from(artifacts)
                .where(eq(artifacts.turnId, turn.id))
            : [];
        const verdict = nextRunStep(turn ?? null, work, now);
        await update(tx, run.id, {
          nextCheckAt: new Date(now.getTime() + 4_000),
          waitingFor: verdict.action === 'wait' ? (verdict.for ?? null) : null,
        });

        if (verdict.action === 'fail') {
          if (turn?.state === 'running') {
            const changed = await tx
              .update(agentTurns)
              .set({
                state: 'failed',
                answer: verdict.reason,
                updatedAt: now,
                revision: sql`${agentTurns.revision} + 1`,
              })
              .where(
                and(
                  eq(agentTurns.id, turn.id),
                  eq(agentTurns.state, 'running'),
                  lte(agentTurns.updatedAt, turn.updatedAt),
                ),
              )
              .returning({ id: agentTurns.id });
            if (!changed.length) return { turnId: null };
          }
          return finish(verdict.reason);
        }
        if (verdict.action === 'dispatch') return { turnId: turn?.id ?? null };
        if (verdict.action === 'wait') return { turnId: null };
        if (verdict.action === 'finish') {
          if (turn?.purpose === 'plan') {
            const plan = runPlan.safeParse(turn.plan);
            if (!plan.success)
              return finish(
                'Pip could not prepare a valid plan for this goal.',
              );
            await tx.insert(runSteps).values(
              plan.data.map((instruction, index) => ({
                runId: run.id,
                instruction,
                position: index + 2,
              })),
            );
          }
          await tx
            .update(runSteps)
            .set({ completedAt: now })
            .where(
              and(
                eq(runSteps.runId, run.id),
                eq(runSteps.position, step.position),
              ),
            );
          return { turnId: null };
        }
        if (step.attempt >= 3)
          return finish(
            'This step needs more input. Create a new Run with the details Pip asked for.',
          );
        const [created] = await tx
          .insert(agentTurns)
          .values({
            businessId: run.businessId,
            creatorId: run.creatorId,
            runId: run.id,
            prompt: [
              `Run goal: ${run.goal}`,
              `Step ${step.position}: ${step.instruction}`,
              ...(verdict.action === 'continue'
                ? [
                    'Continue this same step using the saved owner answers. Review previously saved work before creating another draft.',
                  ]
                : []),
            ].join('\n\n'),
          })
          .returning({ id: agentTurns.id });
        if (!created) throw new Error('Could not create the Run turn.');
        await tx
          .update(runSteps)
          .set({ turnId: created.id, attempt: step.attempt + 1 })
          .where(
            and(
              eq(runSteps.runId, run.id),
              eq(runSteps.position, step.position),
            ),
          );
        return { turnId: created.id };
      });
    },
  };
}
