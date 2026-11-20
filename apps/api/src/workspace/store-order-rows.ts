import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

export function storeOrderRows(filter: SQL, limit: number) {
  return sql`
          select orders.id, orders.email, orders.currency, orders.status, orders.delivery,
            case when orders.discount_code is null then null else json_build_object(
              'code', orders.discount_code, 'amount', orders.discount_amount
            ) end as discount,
            case when orders.tracking_number is null then null else json_build_object(
              'carrier', orders.tracking_carrier, 'number', orders.tracking_number, 'url', orders.tracking_url
            ) end as tracking,
            to_char(orders.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt",
            (select json_agg(json_build_object('productId', product_id, 'productName', product_name,
              'unitPrice', unit_price, 'quantity', quantity) order by product_name, product_id)
             from generated_store_order_lines where site_id = orders.site_id and order_id = orders.id) as items,
            orders.sale_id as "saleId",
            sales.mode as "paymentMode",
            coalesce(sales.amount_refunded, 0)::int as "amountRefunded",
            case
              when sales.id is null then null
              when sales.closed_at is not null then 'closed'
              when sales.amount_refunded = sales.amount then 'refunded'
              when sales.amount_refunded > 0 then 'partially_refunded'
              when sales.paid_at is not null then 'paid'
              else 'awaiting_payment'
            end as payment
          from generated_store_orders as orders
          join workspace_artifacts site on site.id = orders.site_id and site.kind = 'website'
        left join stripe_sales as sales on sales.id = orders.sale_id and sales.business_id = site.business_id
          where ${filter} order by orders.created_at desc, orders.id desc limit ${limit}
  `;
}
