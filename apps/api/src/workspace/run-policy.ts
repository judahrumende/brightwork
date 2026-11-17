type Turn = {
  state: 'queued' | 'running' | 'completed' | 'failed';
  answer: string;
  updatedAt: Date;
};
type Result = {
  kind: string;
  state: string;
  answered: boolean;
};

export function nextRunStep(turn: Turn | null, work: Result[], now: Date) {
  if (!turn) return { action: 'start' } as const;
  if (turn.state === 'queued') return { action: 'dispatch' } as const;
  if (turn.state === 'failed')
    return {
      action: 'fail',
      reason: turn.answer || 'This step stopped.',
    } as const;
  if (turn.state === 'running')
    return now.getTime() - turn.updatedAt.getTime() > 5 * 60_000
      ? ({
          action: 'fail',
          reason: 'The worker stopped during this step.',
        } as const)
      : ({ action: 'wait' } as const);
  if (work.some((item) => item.kind === 'question' && !item.answered))
    return { action: 'wait', for: 'answer' } as const;
  if (work.some((item) => item.state === 'pending'))
    return { action: 'wait', for: 'approval' } as const;
  if (work.some((item) => item.kind === 'question'))
    return { action: 'continue' } as const;
  return { action: 'finish' } as const;
}
