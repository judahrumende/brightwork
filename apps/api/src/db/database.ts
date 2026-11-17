import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

export function connectDatabase(url: string) {
  const sql = postgres(url, { connect_timeout: 5, max: 10 });
  return { db: drizzle(sql), close: () => sql.end({ timeout: 5 }) };
}
export type Database = ReturnType<typeof connectDatabase>['db'];
