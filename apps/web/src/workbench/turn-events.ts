type Part =
  | { type: 'text'; text: string }
  | {
      type: 'tool';
      name: string;
      toolCallId: string;
      status: string;
      output?: unknown;
    };

export type Turn = {
  id: string;
  prompt: string;
  text: string;
  parts: Part[];
  status: 'queued' | 'running' | 'completed' | 'failed';
  revision: number;
  usage?: { inputTokens: number; outputTokens: number };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPart(value: unknown): value is Part {
  if (!isRecord(value)) return false;
  return value.type === 'text'
    ? typeof value.text === 'string'
    : value.type === 'tool' &&
        typeof value.name === 'string' &&
        typeof value.toolCallId === 'string' &&
        typeof value.status === 'string';
}

function isStatus(value: unknown): value is Turn['status'] {
  return (
    value === 'queued' ||
    value === 'running' ||
    value === 'completed' ||
    value === 'failed'
  );
}

function isUsage(value: unknown): value is NonNullable<Turn['usage']> {
  return (
    isRecord(value) &&
    typeof value.inputTokens === 'number' &&
    Number.isSafeInteger(value.inputTokens) &&
    value.inputTokens >= 0 &&
    typeof value.outputTokens === 'number' &&
    Number.isSafeInteger(value.outputTokens) &&
    value.outputTokens >= 0
  );
}

export function readTurnSnapshot(value: unknown, id: string): Turn | null {
  if (
    !isRecord(value) ||
    value.id !== id ||
    typeof value.prompt !== 'string' ||
    typeof value.text !== 'string' ||
    !Array.isArray(value.parts) ||
    !value.parts.every(isPart) ||
    !isStatus(value.status) ||
    typeof value.revision !== 'number' ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0
  )
    return null;
  return {
    id,
    prompt: value.prompt,
    text: value.text,
    parts: value.parts,
    status: value.status,
    revision: value.revision,
    ...(isUsage(value.usage) ? { usage: value.usage } : {}),
  };
}

export function applyTurnChanges(previous: Turn, value: unknown): Turn | null {
  if (
    !isRecord(value) ||
    value.id !== previous.id ||
    value.from !== previous.revision ||
    !Array.isArray(value.changes)
  )
    return null;
  const next = { ...previous };
  for (const change of value.changes) {
    if (
      !isRecord(change) ||
      change.op !== 'set' ||
      !Array.isArray(change.path) ||
      change.path.length !== 1
    )
      return null;
    switch (change.path[0]) {
      case 'text':
        if (typeof change.value !== 'string') return null;
        next.text = change.value;
        break;
      case 'parts':
        if (!Array.isArray(change.value) || !change.value.every(isPart))
          return null;
        next.parts = change.value;
        break;
      case 'status':
        if (!isStatus(change.value)) return null;
        next.status = change.value;
        break;
      case 'usage':
        if (!isUsage(change.value)) return null;
        next.usage = change.value;
        break;
      case 'revision':
        if (
          typeof change.value !== 'number' ||
          !Number.isSafeInteger(change.value) ||
          change.value <= previous.revision
        )
          return null;
        next.revision = change.value;
        break;
      case 'updatedAt':
        break;
      default:
        return null;
    }
  }
  return next.revision > previous.revision ? next : null;
}
