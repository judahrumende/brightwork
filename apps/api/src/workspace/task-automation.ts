import { and, asc, eq, gt, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import type { Database } from '../db/database';
import {
  agentTurns,
  artifacts,
  inboundEmails,
  members,
  taskAutomations,
  taskEmailOccurrences,
} from '../db/schema';
import { upcomingOccurrences } from './recurrence';
import { canLeadRun } from './run-store';

export function taskAutomationStore(db: Database) {
  return {
    async advance(now = new Date()) {
      return db.transaction(async (tx) => {
        const pending = tx
          .select({
            id: inboundEmails.id,
            recordedAt: inboundEmails.recordedAt,
          })
          .from(inboundEmails)
          .leftJoin(
            taskEmailOccurrences,
            and(
              eq(taskEmailOccurrences.emailId, inboundEmails.id),
              eq(taskEmailOccurrences.taskId, taskAutomations.taskId),
            ),
          )
          .where(
            and(
              eq(inboundEmails.businessId, artifacts.businessId),
              gt(inboundEmails.recordedAt, taskAutomations.emailAfter),
              lte(inboundEmails.recordedAt, now),
              isNull(taskEmailOccurrences.emailId),
            ),
          )
          .orderBy(asc(inboundEmails.recordedAt), asc(inboundEmails.id))
          .limit(1)
          .as('pending_email');
        const [record] = await tx
          .select({
            automation: taskAutomations,
            received: { id: pending.id, recordedAt: pending.recordedAt },
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
          .leftJoinLateral(pending, sql`true`)
          .where(
            and(
              eq(taskAutomations.enabled, true),
              lte(taskAutomations.checkAt, now),
              or(
                lte(taskAutomations.nextAt, now),
                isNotNull(pending.id),
                sql`${agentTurns.state} in ('queued', 'running')`,
              ),
            ),
          )
          .orderBy(asc(taskAutomations.checkAt), asc(taskAutomations.taskId))
          .limit(1)
          .for('no key update', { of: taskAutomations, skipLocked: true });
        if (!record) return null;
        const { automation, task, turn, received } = record;
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
        let prompt: string;
        let nextAt: Date | null = null;
        if (received) {
          await tx
            .insert(taskEmailOccurrences)
            .values({ taskId: automation.taskId, emailId: received.id });
          prompt = `Inbox task: ${task.title}\n\n${task.body}\n\nA new email arrived at ${received.recordedAt.toISOString()}.`;
        } else {
          if (!automation.nextAt || !task.dueAt) return { turnId: null };
          const [next] = upcomingOccurrences(
            task.dueAt,
            task.recurrence,
            task.timezone,
            new Date(automation.nextAt.getTime() + 1),
            1,
          );
          nextAt = next ? new Date(next) : null;
          prompt = `Scheduled task: ${task.title}\n\n${task.body}\n\nScheduled for ${automation.nextAt.toISOString()}.`;
        }
        const [created] = await tx
          .insert(agentTurns)
          .values({
            businessId: task.businessId,
            creatorId: automation.creatorId,
            prompt,
          })
          .returning({ id: agentTurns.id });
        if (!created) throw new Error('Could not create scheduled turn.');
        await tx
          .update(taskAutomations)
          .set({
            nextAt,
            lastScheduledAt: automation.nextAt,
            turnId: created.id,
            checkAt,
          })
          .where(scope);
        return { turnId: created.id };
      });
    },
  };
}
