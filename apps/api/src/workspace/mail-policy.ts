export type EmailResult =
  | { kind: 'accepted'; id: string }
  | { kind: 'retry'; note: string }
  | { kind: 'rejected'; note: string };

export function mayAttemptEmail(
  attempts: number,
  firstAttemptAt: Date | null,
  now: Date,
) {
  return (
    attempts < 4 &&
    (firstAttemptAt === null ||
      now.getTime() - firstAttemptAt.getTime() < 23 * 3_600_000)
  );
}

export function emailOutcome(
  result: EmailResult,
  attempts: number,
  firstAttemptAt: Date,
  now: Date,
) {
  if (result.kind === 'accepted')
    return {
      state: 'accepted',
      providerId: result.id,
      note: null,
      nextCheckAt: now,
    } as const;
  const nextCheckAt = new Date(now.getTime() + attempts * 30_000);
  if (
    result.kind === 'retry' &&
    mayAttemptEmail(attempts, firstAttemptAt, nextCheckAt)
  )
    return {
      state: 'queued',
      providerId: null,
      note: result.note,
      nextCheckAt,
    } as const;
  return {
    state:
      result.kind === 'rejected' && attempts === 1 ? 'failed' : 'needs_review',
    providerId: null,
    note: result.note,
    nextCheckAt: now,
  } as const;
}
