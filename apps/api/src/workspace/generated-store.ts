import { productPhoto } from './store-product-photo';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { storeCurrency, storeProductInput } from '@brightwork/shared';
import type {
  StoreOrder,
  StoreOrderLine,
  StoreProduct,
} from '@brightwork/shared';
import { z } from 'zod';
import type { Database } from '../db/database';

export const productEdit = storeProductInput
  .extend({
    id: z.uuid().optional(),
    revision: z.number().int().positive().optional(),
    parentId: z.uuid().nullish(),
    sku: z.string().trim().max(80).nullish(),
    photo: productPhoto.nullable().optional(),
    photoAlt: z.string().trim().min(1).max(160).nullish(),
  })
  .refine(
    ({ id, revision, parentId }) =>
      Boolean(id) === Boolean(revision) && !(id && parentId),
  );
export const orderAction = z.enum(['confirmed', 'fulfilled', 'cancelled']);
const orderLine = z.object({
  productId: z.uuid(),
  revision: z.coerce.number().int().positive(),
  quantity: z.coerce.number().int().min(1).max(20),
});
const orderDetails = z.object({
  id: z.uuid(),
  email: z
    .email()
    .trim()
    .max(254)
    .transform((value) => value.toLowerCase()),
});
export const orderRequest = z
  .union([
    orderDetails.extend({
      items: z
        .array(orderLine)
        .min(1)
        .max(20)
        .refine(
          (items) =>
            new Set(items.map((line) => line.productId.toLowerCase())).size ===
            items.length,
        ),
    }),
    orderDetails.extend(orderLine.shape),
  ])
  .transform((input) => ({
    id: input.id.toLowerCase(),
    email: input.email,
    items: ('items' in input ? input.items : [input]).map((item) => ({
      ...item,
      productId: item.productId.toLowerCase(),
    })),
  }));

const storeScope = (businessId: string) => sql`exists (
  select 1 from workspace_artifacts where id = generated_stores.site_id
  and business_id = ${businessId} and kind = 'website'
)`;
const liveScope = sql`exists (
  select 1 from website_publications where artifact_id = generated_stores.site_id and unpublished_at is null
  and draft_revision >= generated_stores.first_revision
)`;

const visible = sql`products.active and (products.parent_id is null or parent.active)`;
const sellable = sql`${visible}
  and not exists (select 1 from generated_store_products variant
    where variant.site_id = products.site_id and variant.parent_id = products.id)`;

export function generatedStores(db: Database) {
  async function scopedStore(businessId: string, siteId: string) {
    const [store] = await db.execute<{ currency: string }>(sql`
      select currency from generated_stores where site_id = ${siteId} and ${storeScope(businessId)}
    `);
    return store;
  }
  return {
    scopedStore,
    async read(businessId: string, siteId: string) {
      const store = await scopedStore(businessId, siteId);
      if (!store) return null;
      const [products, orders] = await Promise.all([
        db.execute<StoreProduct>(sql`
          select products.id, products.name, products.description, products.price, products.stock,
            products.active, products.revision, products.parent_id as "parentId", products.sku, photos.alt as "photoAlt"
          from generated_store_products products
          left join generated_store_product_photos photos on photos.site_id = products.site_id and photos.product_id = products.id
          left join generated_store_products parent on parent.site_id = products.site_id and parent.id = products.parent_id
          where products.site_id = ${siteId}
          order by coalesce(parent.name, products.name), coalesce(products.parent_id, products.id),
            products.parent_id is not null, products.name, products.id
        `),
        db.execute<StoreOrder>(sql`
          select orders.id, orders.email, orders.currency, orders.status, orders.created_at as "createdAt",
            (select json_agg(json_build_object('productId', product_id, 'productName', product_name,
              'unitPrice', unit_price, 'quantity', quantity) order by product_name, product_id)
             from generated_store_order_lines where site_id = orders.site_id and order_id = orders.id) as items,
            orders.sale_id as "saleId",
            case
              when orders.sale_id is null then null
              when sales.closed_at is not null then 'closed'
              when sales.amount_refunded = sales.amount then 'refunded'
              when sales.amount_refunded > 0 then 'partially_refunded'
              when sales.paid_at is not null then 'paid'
              else 'awaiting_payment'
            end as payment
          from generated_store_orders as orders
          left join stripe_sales as sales on sales.id = orders.sale_id and sales.business_id = ${businessId}
          where orders.site_id = ${siteId} order by orders.created_at desc, orders.id desc limit 200
        `),
      ]);
      return { ...store, products, orders };
    },
    async saveProduct(
      businessId: string,
      siteId: string,
      input: z.infer<typeof productEdit>,
    ) {
      const {
        id,
        revision,
        name,
        description,
        price,
        stock,
        active,
        photo,
        parentId,
      } = input;
      const sku = input.sku === undefined ? undefined : input.sku || null;
      return db.transaction(async (tx) => {
        const [store] = await tx.execute(sql`
          select site_id from generated_stores where site_id = ${siteId} and ${storeScope(businessId)} for update
        `);
        if (!store) return false;
        if (parentId) {
          const [parent] = await tx.execute(sql`
            select id from generated_store_products where site_id = ${siteId} and id = ${parentId} and parent_id is null
          `);
          if (!parent) return false;
        }
        const saved = id
          ? await tx.execute<{ id: string }>(sql`
            update generated_store_products set name = ${name}, description = ${description},
              price = ${price}, stock = ${stock}, active = ${active}, revision = revision + 1
              ${sku !== undefined ? sql`, sku = ${sku}` : sql.empty()}
            where site_id = ${siteId} and id = ${id} and revision = ${revision}
              and not exists (select 1 from generated_store_products other where other.site_id = ${siteId}
                and other.id <> ${id} and (
                  lower(other.sku) = lower(${sku ?? null}::text)
                  or (other.parent_id = generated_store_products.parent_id and lower(other.name) = lower(${name}))
                ))
            returning id
          `)
          : await tx.execute<{ id: string }>(sql`
            insert into generated_store_products(site_id, name, description, price, stock, active, parent_id, sku)
            values (${siteId}, ${name}, ${description}, ${price}, ${stock}, ${active}, ${parentId ?? null}, ${sku ?? null})
            on conflict do nothing returning id
          `);
        const item = saved[0];
        if (!item) return false;
        if (photo) {
          await tx.execute(sql`
            insert into generated_store_product_photos(site_id, product_id, mime, content, alt)
            values (${siteId}, ${item.id}, ${photo.mime}, ${photo.content}, ${photo.alt})
            on conflict (site_id, product_id) do update
            set mime = excluded.mime, content = excluded.content, alt = excluded.alt
          `);
        } else if (photo === null) {
          await tx.execute(
            sql`delete from generated_store_product_photos where site_id = ${siteId} and product_id = ${item.id}`,
          );
        } else if (input.photoAlt) {
          await tx.execute(sql`update generated_store_product_photos set alt = ${input.photoAlt}
            where site_id = ${siteId} and product_id = ${item.id}`);
        }
        return true;
      });
    },
    async photo(siteId: string, productId: string, businessId?: string) {
      const [photo] = await db.execute<{ mime: string; content: Buffer }>(sql`
        select photos.mime, photos.content from generated_store_product_photos photos
        join generated_stores on generated_stores.site_id = photos.site_id
        join generated_store_products products on products.site_id = photos.site_id and products.id = photos.product_id
        left join generated_store_products parent on parent.site_id = products.site_id and parent.id = products.parent_id
        where photos.site_id = ${siteId} and photos.product_id = ${productId}
          and ${businessId ? storeScope(businessId) : sql`(${liveScope} and products.active and (products.parent_id is null or parent.active))`}
      `);
      return photo;
    },
    async setCurrency(
      businessId: string,
      siteId: string,
      currency: z.infer<typeof storeCurrency>,
    ) {
      return db.transaction(async (tx) => {
        const [locked] = await tx.execute(sql`
          select site_id from generated_stores where site_id = ${siteId} and ${storeScope(businessId)} for update
        `);
        if (!locked) return false;
        const result = await tx.execute(sql`
          update generated_stores set currency = ${currency}
          where site_id = ${siteId}
            and not exists(select 1 from generated_store_products where site_id = ${siteId})
          returning site_id
        `);
        return result.length === 1;
      });
    },
    async catalog(siteId: string) {
      const [store] = await db.execute<{ currency: string; title: string }>(sql`
        select generated_stores.currency, coalesce(website_versions.title, 'Store') as title from generated_stores
        join website_publications on website_publications.artifact_id = generated_stores.site_id
          and website_publications.unpublished_at is null
          and website_publications.draft_revision >= generated_stores.first_revision
        left join website_versions on website_versions.artifact_id = generated_stores.site_id
          and website_versions.revision = website_publications.draft_revision
        where generated_stores.site_id = ${siteId}
      `);
      if (!store) return null;
      const products = await db.execute<
        StoreProduct & {
          groupName: string;
          groupDescription: string;
          photoId: string | null;
        }
      >(sql`
        select products.id, products.name, products.description, products.price, products.stock, products.revision,
          products.active, products.parent_id as "parentId",
          coalesce(parent.name, products.name) as "groupName",
          coalesce(parent.description, products.description) as "groupDescription",
          coalesce(photos.product_id, inherited.product_id) as "photoId",
          coalesce(photos.alt, inherited.alt) as "photoAlt"
        from generated_store_products products
        left join generated_store_products parent on parent.site_id = products.site_id and parent.id = products.parent_id
        left join generated_store_product_photos photos on photos.site_id = products.site_id and photos.product_id = products.id
        left join generated_store_product_photos inherited on inherited.site_id = products.site_id and inherited.product_id = parent.id
        where products.site_id = ${siteId} and ${sellable}
        order by coalesce(parent.name, products.name), coalesce(products.parent_id, products.id), products.name, products.id
      `);
      return { ...store, products };
    },
    async request(siteId: string, raw: z.input<typeof orderRequest>) {
      const input = orderRequest.parse(raw);
      return db.transaction(async (tx) => {
        const [store] = await tx.execute<{ currency: string }>(sql`
          select currency from generated_stores where site_id = ${siteId} and ${liveScope} for update
        `);
        if (!store) return false;
        const [existing] = await tx.execute<{ email: string }>(sql`
          select email from generated_store_orders where site_id = ${siteId} and id = ${input.id}
        `);
        if (existing) {
          if (existing.email !== input.email) return false;
          const lines = await tx.execute<{
            product_id: string;
            quantity: number;
          }>(sql`
            select product_id, quantity from generated_store_order_lines
            where site_id = ${siteId} and order_id = ${input.id}
          `);
          return (
            lines.length === input.items.length &&
            input.items.every((item) =>
              lines.some(
                (line) =>
                  line.product_id === item.productId &&
                  line.quantity === item.quantity,
              ),
            )
          );
        }
        const ids = sql.join(
          input.items.map(({ productId }) => sql`${productId}::uuid`),
          sql`,`,
        );
        const products = await tx.execute<StoreProduct>(sql`
          select products.id, case when parent.id is null then products.name
            else parent.name || ' · ' || products.name end as name,
            products.price, products.stock, products.revision from generated_store_products products
          left join generated_store_products parent on parent.site_id = products.site_id and parent.id = products.parent_id
          where products.site_id = ${siteId} and products.id in (${ids}) and ${sellable}
        `);
        const items: StoreOrderLine[] = [];
        for (const item of input.items) {
          const product = products.find(({ id }) => id === item.productId);
          if (
            !product ||
            product.revision !== item.revision ||
            product.stock < item.quantity
          )
            return false;
          items.push({
            productId: product.id,
            productName: product.name,
            unitPrice: product.price,
            quantity: item.quantity,
          });
        }
        const first = items[0];
        if (!first) return false;
        await tx.execute(sql`
          insert into generated_store_orders(site_id, id, product_id, product_name, unit_price, currency, quantity, email)
          values (${siteId}, ${input.id}, ${first.productId}, ${first.productName}, ${first.unitPrice}, ${store.currency}, ${first.quantity}, ${input.email})
        `);
        const rows = sql.join(
          items.map(
            (item) =>
              sql`(${siteId}, ${input.id}, ${item.productId}, ${item.productName}, ${item.unitPrice}, ${item.quantity})`,
          ),
          sql`,`,
        );
        await tx.execute(sql`
          insert into generated_store_order_lines(site_id, order_id, product_id, product_name, unit_price, quantity)
          values ${rows}
        `);
        return true;
      });
    },
    async createPayment(businessId: string, siteId: string, id: string) {
      return db.transaction(async (tx) => {
        const [store] = await tx.execute(sql`
          select site_id from generated_stores where site_id = ${siteId} and ${storeScope(businessId)} for update
        `);
        if (!store) return null;
        const [order] = await tx.execute<{
          sale_id: string | null;
          currency: string;
        }>(sql`
          select sale_id, currency from generated_store_orders
          where site_id = ${siteId} and id = ${id} and status = 'confirmed'
        `);
        if (!order) return null;
        if (order.sale_id) return order.sale_id;
        const lines = await tx.execute<{
          product_name: string;
          unit_price: number;
          quantity: number;
        }>(sql`
          select product_name, unit_price, quantity from generated_store_order_lines
          where site_id = ${siteId} and order_id = ${id} order by product_name, product_id
        `);
        const amount = lines.reduce(
          (sum, item) => sum + item.unit_price * item.quantity,
          0,
        );
        if (amount < 1 || amount > 99_999_999) return null;
        const saleId = randomUUID();
        const first = lines[0]!;
        const title =
          lines.length === 1
            ? `${first.product_name} × ${first.quantity}`
            : `${first.product_name} and ${lines.length - 1} more`;
        const [sale] = await tx.execute(sql`
          insert into stripe_sales(id, business_id, account_id, title, currency, amount)
          select ${saleId}, business_id, account_id, ${title}, ${order.currency.toLowerCase()}, ${amount}
          from stripe_sellers where business_id = ${businessId}
            and details_submitted and charges_enabled and payouts_enabled
          returning id
        `);
        if (!sale) return null;
        await tx.execute(sql`
          update generated_store_orders set sale_id = ${saleId} where site_id = ${siteId} and id = ${id}
        `);
        return saleId;
      });
    },
    async changeOrder(
      businessId: string,
      siteId: string,
      id: string,
      status: z.infer<typeof orderAction>,
    ) {
      return db.transaction(async (tx) => {
        const [store] = await tx.execute(sql`
          select site_id from generated_stores where site_id = ${siteId} and ${storeScope(businessId)} for update
        `);
        if (!store) return false;
        const [order] = await tx.execute<{
          status: StoreOrder['status'];
          sale_id: string | null;
        }>(sql`
          select status, sale_id from generated_store_orders
          where site_id = ${siteId} and id = ${id}
        `);
        if (!order) return false;
        if (order.status === status) return true;
        if (order.sale_id) {
          const [sale] = await tx.execute<{
            paid: boolean;
            closed: boolean;
            amount: number;
            amount_refunded: number;
          }>(sql`
            select paid_at is not null as paid, closed_at is not null as closed, amount, amount_refunded
            from stripe_sales where id = ${order.sale_id} and business_id = ${businessId} for update
          `);
          if (!sale) return false;
          if (
            status === 'cancelled' &&
            !sale.closed &&
            sale.amount_refunded !== sale.amount
          )
            return false;
          if (
            status === 'fulfilled' &&
            (!sale.paid || sale.amount_refunded === sale.amount)
          )
            return false;
        }
        const reserve = order.status === 'requested' && status === 'confirmed';
        const restore = order.status === 'confirmed' && status === 'cancelled';
        if (
          !reserve &&
          !restore &&
          !(order.status === 'requested' && status === 'cancelled') &&
          !(order.status === 'confirmed' && status === 'fulfilled')
        )
          return false;
        if (reserve || restore) {
          const scope = sql`lines.site_id = ${siteId} and lines.order_id = ${id}
            and products.site_id = lines.site_id and products.id = lines.product_id`;
          const unavailable = await tx.execute(sql`
            select 1 from generated_store_order_lines lines
            join generated_store_products products on products.site_id = lines.site_id and products.id = lines.product_id
            left join generated_store_products parent on parent.site_id = products.site_id and parent.id = products.parent_id
            where ${scope} and ${
              reserve
                ? sql`(not (${visible}) or products.stock < lines.quantity)`
                : sql`products.stock + lines.quantity > 1000000`
            } limit 1
          `);
          if (unavailable.length) return false;
          const changed = await tx.execute(sql`
            update generated_store_products products set
              stock = ${reserve ? sql`products.stock - lines.quantity` : sql`products.stock + lines.quantity`},
              revision = products.revision + 1 from generated_store_order_lines lines where ${scope}
            returning products.id
          `);
          if (!changed.length) return false;
        }
        await tx.execute(
          sql`update generated_store_orders set status = ${status} where site_id = ${siteId} and id = ${id}`,
        );
        return true;
      });
    },
  };
}
