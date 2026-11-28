import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/database';

export const commerceRange = z
  .object({
    from: z.iso.date(),
    through: z.iso.date(),
    mode: z.enum(['test', 'live']).default('test'),
  })
  .refine(({ from, through }) => {
    const difference = Date.parse(through) - Date.parse(from);
    return difference >= 0 && difference < 366 * 86_400_000;
  });

export async function commerceInsights(
  db: Database,
  businessId: string,
  range: z.infer<typeof commerceRange>,
) {
  const where = sql`business_id = ${businessId}::uuid
    AND occurred_at >= ${range.from}::date::timestamp AT TIME ZONE 'UTC'
    AND occurred_at < (${range.through}::date + 1)::timestamp AT TIME ZONE 'UTC'
    AND (source <> 'stripe' OR payment_mode = ${range.mode ?? 'test'})`;
  const [revenue, [customers]] = await Promise.all([
    db.execute<{
      source: 'shopify' | 'stripe';
      currency: string;
      sales: number;
      gross: string;
      refunded: string;
      net: string;
    }>(sql`
      SELECT source, currency, count(*)::int AS sales, sum(gross)::text AS gross,
             sum(refunded)::text AS refunded, sum(gross - refunded)::text AS net
      FROM commerce_insight_facts WHERE ${where}
      GROUP BY source, currency ORDER BY currency, source
    `),
    db.execute<{
      identified: number;
      repeat: number;
      unattributed: number;
    }>(sql`
      WITH customer_totals AS (
        SELECT customer_key, count(*) AS purchases FROM commerce_insight_facts
        WHERE ${where} GROUP BY customer_key
      )
      SELECT count(*) FILTER (WHERE customer_key IS NOT NULL)::int AS identified,
             count(*) FILTER (WHERE customer_key IS NOT NULL AND purchases > 1)::int AS repeat,
             coalesce(sum(purchases) FILTER (WHERE customer_key IS NULL), 0)::int AS unattributed
      FROM customer_totals
    `),
  ]);
  return { mode: range.mode ?? 'test', revenue: [...revenue], customers };
}
