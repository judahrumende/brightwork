import type { Database } from '../db/database';
import { emailOutcome } from './mail-policy';
import type { EmailResult } from './mail-policy';
import { sql } from 'drizzle-orm';

export type StoreEmailAttempt = {
  id: string;
  sender: string;
  recipient: string;
  subject: string;
  body: string;
  attempts: number;
  firstAttemptAt: Date;
};

export function storeEmailOutbox(db: Database) {
  return {
    async claim(
      sender: string,
      now = new Date(),
    ): Promise<StoreEmailAttempt | null> {
      return db.transaction(async (tx) => {
        const nowIso = now.toISOString();
        const [email] = await tx.execute<{
          id: string;
          recipient: string;
          subject: string;
          body: string;
          attempts: number;
          first_attempt_at: Date | null;
        }>(sql`
          select id, recipient, subject, body, attempts, first_attempt_at
          from generated_store_email_outbox
          where state in ('queued', 'sending') and next_check_at <= ${nowIso}
          order by next_check_at, id limit 1 for update skip locked
        `);
        if (!email) return null;
        const attempts = email.attempts + 1;
        const firstAttemptAt = email.first_attempt_at ?? now;
        const [claimed] = await tx.execute<{ id: string }>(sql`
          update generated_store_email_outbox set state = 'sending', attempts = ${attempts},
            first_attempt_at = ${firstAttemptAt.toISOString()},
            next_check_at = ${new Date(now.getTime() + 120_000).toISOString()}
          where id = ${email.id} returning id
        `);
        return claimed
          ? {
              id: email.id,
              sender,
              recipient: email.recipient,
              subject: email.subject,
              body: email.body,
              attempts,
              firstAttemptAt,
            }
          : null;
      });
    },

    async record(
      attempt: StoreEmailAttempt,
      result: EmailResult,
      now = new Date(),
    ) {
      const outcome = emailOutcome(
        result,
        attempt.attempts,
        attempt.firstAttemptAt,
        now,
      );
      await db.execute(sql`
        update generated_store_email_outbox set state = ${outcome.state},
          provider_id = ${outcome.providerId}, note = ${outcome.note},
          next_check_at = ${outcome.nextCheckAt.toISOString()}
        where id = ${attempt.id} and state = 'sending' and attempts = ${attempt.attempts}
      `);
    },
  };
}
