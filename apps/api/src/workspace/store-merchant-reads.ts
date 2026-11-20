import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { z } from 'zod';
import { storeOrderStatus } from '@brightwork/shared';

const search = z.string().trim().max(120).optional();
export const merchantOrdersQuery = z
  .object({
    q: search,
    status: storeOrderStatus.optional(),
    before: z.iso.datetime().optional(),
    id: z.uuid().optional(),
  })
  .refine(({ before, id }) => Boolean(before) === Boolean(id));

export const merchantCustomersQuery = z.object({
  q: search,
  kind: z.enum(['verified', 'guest']).optional(),
  after: z.email().max(254).optional(),
});
export const merchantEmailsQuery = z
  .object({
    before: z.iso.datetime().optional(),
    id: z.uuid().optional(),
  })
  .refine(({ before, id }) => Boolean(before) === Boolean(id));
export const merchantActivityQuery = z
  .object({
    before: z.iso.datetime().optional(),
    id: z.uuid().optional(),
  })
  .refine(({ before, id }) => Boolean(before) === Boolean(id));
export const merchantReportQuery = z
  .object({
    from: z.iso.date(),
    through: z.iso.date(),
    mode: z.enum(['test', 'live']).default('test'),
  })
  .refine(({ from, through }) => {
    const days = (Date.parse(through) - Date.parse(from)) / 86_400_000;
    return days >= 0 && days < 366;
  }, 'Choose up to 366 days.');

export const merchantPageSize = 25;

export function customerRows(
  siteId: string,
  options: z.infer<typeof merchantCustomersQuery>,
  limit: number,
  order: 'recent' | 'email',
) {
  const keyword = options.q
    ? sql`and strpos(email, lower(${options.q})) > 0`
    : sql.empty();
  const after = options.after ? sql`and email > ${options.after}` : sql.empty();
  const account =
    options.kind === 'verified'
      ? sql`where verified.email is not null`
      : options.kind === 'guest'
        ? sql`where verified.email is null`
        : sql.empty();
  return sql`
    with order_history as (
      select email, count(*)::int as count, max(created_at) as latest
      from generated_store_orders where site_id = ${siteId} ${keyword} ${after} group by email
    ), verified as (
      select email, created_at from generated_store_buyers where site_id = ${siteId} ${keyword} ${after}
    )
    select coalesce(order_history.email, verified.email) as email,
      coalesce(order_history.count, 0) as "orderCount",
      order_history.latest as "lastOrderAt", verified.created_at as "joinedAt"
    from order_history full join verified on order_history.email = verified.email
    ${account}
    order by ${order === 'email' ? sql`email` : sql`greatest(order_history.latest, verified.created_at) desc, email`}
    limit ${limit}
  `;
}

export function orderFilter(
  siteId: string,
  options: z.infer<typeof merchantOrdersQuery>,
): SQL {
  return sql`
    orders.site_id = ${siteId}
    ${options.status ? sql`and orders.status = ${options.status}` : sql.empty()}
    ${options.before && options.id ? sql`and (orders.created_at, orders.id) < (${options.before}::timestamptz, ${options.id}::uuid)` : sql.empty()}
    ${
      options.q
        ? sql`and (
      strpos(orders.email, lower(${options.q})) > 0 or strpos(orders.id::text, lower(${options.q})) > 0
      or exists (select 1 from generated_store_order_lines as lines
        where lines.site_id = orders.site_id and lines.order_id = orders.id
          and strpos(lower(lines.product_name), lower(${options.q})) > 0)
    )`
        : sql.empty()
    }
  `;
}

export function reportRows(
  businessId: string,
  siteId: string,
  range: z.infer<typeof merchantReportQuery>,
) {
  const from = range.from + 'T00:00:00Z';
  const through = sql`(${range.through}::date + 1)::timestamp at time zone 'UTC'`;
  return sql`
    with requests as (
      select (created_at at time zone 'UTC')::date as day, count(*)::int as requests,
        count(*) filter (where status = 'cancelled')::int as cancelled
      from generated_store_orders
      where site_id = ${siteId} and created_at >= ${from}::timestamptz and created_at < (${through})
      group by day
    ), payments as (
      select (sale.paid_at at time zone 'UTC')::date as day, count(*)::int as paid,
        sum(sale.amount) as gross, sum(sale.amount_refunded) as refunds
      from generated_store_orders as orders
      join stripe_sales sale on sale.id = orders.sale_id and sale.business_id = ${businessId}
      where orders.site_id = ${siteId} and sale.currency = lower(orders.currency)
        and sale.mode = ${range.mode ?? 'test'}
        and sale.paid_at >= ${from}::timestamptz and sale.paid_at < (${through})
      group by day
    )
    select to_char(calendar.day, 'YYYY-MM-DD') as day,
      coalesce(requests.requests, 0) as requests, coalesce(requests.cancelled, 0) as cancelled,
      coalesce(payments.paid, 0) as "paidOrders",
      coalesce(payments.gross, 0)::text as gross, coalesce(payments.refunds, 0)::text as refunds
    from generate_series(${range.from}::date::timestamp, ${range.through}::date::timestamp, interval '1 day') as calendar(day)
    left join requests on requests.day = calendar.day
    left join payments on payments.day = calendar.day
    order by calendar.day
  `;
}
