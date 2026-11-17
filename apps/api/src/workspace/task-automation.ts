import { and, asc, eq, isNotNull, lte, or, sql } from 'drizzle-orm';
import type { Database } from '../db/database';
import { agentTurns, artifacts, members, taskAutomations } from '../db/schema';
import { upcomingOccurrences } from './recurrence';
import { canLeadRun } from './run-store';

export function taskAutomationStore(db: Database) {
  return {
    async advance(now = new Date()) {
      return db.transaction(async (tx) => {
        const [record] = await tx
          .select({
            automation: taskAutomations,
            task: {
              businessId: artifacts.businessId,
              title: artifacts.title,
              body: artifacts.body,
              dueAt: artifacts.dueAt,
              recurrence: artifacts.recurrence,
              timezone: artifacts.scheduleTimezone,
            },
            turn: {
              id: agentTurns.id,
              state: agentTurns.state,
              updatedAt: agentTurns.updatedAt,
            },
          })
          .from(taskAutomations)
          .innerJoin(artifacts, eq(artifacts.id, taskAutomations.taskId))
          .leftJoin(agentTurns, eq(agentTurns.id, taskAutomations.turnId))
          .where(
            and(
              eq(taskAutomations.enabled, true),
              lte(taskAutomations.checkAt, now),
              or(
                lte(taskAutomations.nextAt, now),
                sql`${agentTurns.state} in ('queued', 'running')`,
              ),
            ),
          )
          .orderBy(asc(taskAutomations.checkAt), asc(taskAutomations.taskId))
          .limit(1)
          .for('no key update', { of: taskAutomations, skipLocked: true });
        if (!record) return null;
        const { automation, task, turn } = record;
        const scope = eq(taskAutomations.taskId, automation.taskId);
        const [member] = automation.creatorId
          ? await tx
              .select({ role: members.role })
              .from(members)
              .where(
                and(
                  eq(members.businessId, task.businessId),
                  eq(members.accountId, automation.creatorId),
                ),
              )
              .for('share')
          : [];
        if (!automation.creatorId || !member || !canLeadRun(member.role)) {
          await tx.update(taskAutomations).set({ enabled: false }).where(scope);
          if (turn?.state === 'queued') {
            await tx
              .update(agentTurns)
              .set({
                state: 'failed',
                answer:
                  'Scheduled execution paused because its owner lost workspace permissions.',
                updatedAt: now,
                revision: sql`${agentTurns.revision} + 1`,
              })
              .where(
                and(eq(agentTurns.id, turn.id), eq(agentTurns.state, 'queued')),
              );
          }
          return { turnId: null };
        }
        const checkAt = new Date(now.getTime() + 4_000);
        if (turn?.state === 'queued' || turn?.state === 'running') {
          await tx.update(taskAutomations).set({ checkAt }).where(scope);
          if (
            turn.state === 'running' &&
            now.getTime() - turn.updatedAt.getTime() > 5 * 60_000
          ) {
            await tx
              .update(agentTurns)
              .set({
                state: 'failed',
                answer: 'The worker stopped during this scheduled task.',
                updatedAt: now,
                revision: sql`${agentTurns.revision} + 1`,
              })
              .where(
                and(
                  eq(agentTurns.id, turn.id),
                  eq(agentTurns.state, 'running'),
                  lte(agentTurns.updatedAt, turn.updatedAt),
                ),
              );
          }
          return { turnId: turn.state === 'queued' ? turn.id : null };
        }
        if (!automation.nextAt || !task.dueAt) return { turnId: null };
        const [next] = upcomingOccurrences(
          task.dueAt,
          task.recurrence,
          task.timezone,
          new Date(now.getTime() + 1),
          1,
        );
        const [created] = await tx
          .insert(agentTurns)
          .values({
            businessId: task.businessId,
            creatorId: automation.creatorId,
            prompt: `Scheduled task: ${task.title}\n\n${task.body}\n\nScheduled for ${automation.nextAt.toISOString()}.`,
          })
          .returning({ id: agentTurns.id });
        if (!created) throw new Error('Could not create scheduled turn.');
        await tx
          .update(taskAutomations)
          .set({
            nextAt: next ? new Date(next) : null,
            lastScheduledAt: automation.nextAt,
            turnId: created.id,
            checkAt,
          })
          .where(and(scope, isNotNull(taskAutomations.nextAt)));
        return { turnId: created.id };
      });
    },
  };
}
