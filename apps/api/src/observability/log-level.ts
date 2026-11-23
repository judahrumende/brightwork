import { z } from 'zod';

const levels = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
] as const;

export type LogLevel = (typeof levels)[number];

const logLevelSchema = z.enum(levels);

/** Parse LOG_LEVEL. Empty or unset becomes info. */
export function parseLogLevel(value: string | undefined): LogLevel {
  if (value === undefined || value === '') return 'info';
  return logLevelSchema.parse(value);
}
