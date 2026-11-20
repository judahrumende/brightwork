import {
  customerRows,
  merchantPageSize,
  orderFilter,
  reportRows,
} from './store-merchant-reads';
import type {
  merchantCustomersQuery,
  merchantActivityQuery,
  merchantEmailsQuery,
  merchantOrdersQuery,
  merchantReportQuery,
} from './store-merchant-reads';
import { storeOrderRows } from './store-order-rows';
import { productPhoto } from './store-product-photo';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import {
  storeDiscountInput,
  storeCurrency,
  storeDeliveryZones,
  storeOrderTotal,
  storeProductInput,
} from '@brightwork/shared';
import type {
  StoreCustomer,
  StoreActivity,
  StoreDelivery,
  StoreDeliveryAddress,
  StoreDeliveryZone,
  StoreDiscount,
  StoreEmailLog,
  StoreOrder,
  StoreOrderLine,
  StoreProduct,
  StoreReport,
  StoreReportDay,
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
export const discountEdit = storeDiscountInput;
export const orderAction = z.enum(['confirmed', 'fulfilled', 'cancelled']);
export const fulfillmentTracking = z.strictObject({
  carrier: z.string().trim().min(1).max(80),
  number: z.string().trim().min(1).max(120),
  url: z
    .url({ protocol: /^https$/u })
    .transform((value) => new URL(value).href)
    .pipe(z.string().max(2048))
    .refine((value) => {
      const url = new URL(value);
      return !url.username && !url.password;
    }),
});
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
  discountCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9](?:[A-Z0-9-]{1,30}[A-Z0-9])$/u)
    .optional(),
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
    discountCode: input.discountCode ?? null,
    items: ('items' in input ? input.items : [input]).map((item) => ({
      ...item,
      productId: item.productId.toLowerCase(),
    })),
  }));

const storeScope = (businessId: string) => sql`exists (
  select 1 from workspace_artifacts where id = generated_stores.site_id
  and business_id = ${businessId} and kind = 'website'
  and (
    exists (select 1 from website_versions draft
      where draft.artifact_id = generated_stores.site_id
        and draft.revision = workspace_artifacts.revision and draft.runtime_mode = 'store')
    or exists (select 1 from website_publications publication
      join website_versions live on live.artifact_id = publication.artifact_id
        and live.revision = publication.draft_revision and live.runtime_mode = 'store'
      where publication.artifact_id = generated_stores.site_id
        and publication.unpublished_at is null
        and publication.draft_revision >= generated_stores.first_revision)
  )
)`;
const readyStripeSeller = (mode: 'test' | 'live') =>
  sql`mode = ${mode} and details_submitted and charges_enabled and payouts_enabled`;
const liveScope = sql`exists (
  select 1 from website_publications publication
  join website_versions live on live.artifact_id = publication.artifact_id
    and live.revision = publication.draft_revision and live.runtime_mode = 'store'
  where publication.artifact_id = generated_stores.site_id and publication.unpublished_at is null
    and publication.draft_revision >= generated_stores.first_revision
)`;

const visible = sql`products.active and (products.parent_id is null or parent.active)`;
const sellable = sql`${visible}
  and not exists (select 1 from generated_store_products variant
    where variant.site_id = products.site_id and variant.parent_id = products.id)`;

type OrderInput = z.output<typeof orderRequest>;
type CheckoutStore = {
  currency: string;
  zones: StoreDeliveryZone[];
  deliveryRevision: number;
  directCheckout: boolean;
  paymentMode: 'test' | 'live';
  businessId: string;
};
type StoreDiscountSnapshot = { code: string; amount: number } | null;
type CheckoutQuote = {
  id: string;
  input: OrderInput;
  snapshot: {
    items: StoreOrderLine[];
    delivery: StoreDelivery;
    discount: StoreDiscountSnapshot;
  };
  buyer_email: string | null;
  delivery_revision: number;
  currency: string;
};

export function generatedStores(db: Database) {
  async function scopedStore(businessId: string, siteId: string) {
    const [store] = await db.execute<Omit<CheckoutStore, 'businessId'>>(sql`
      select currency, delivery_zones as zones, delivery_revision as "deliveryRevision",
        direct_checkout as "directCheckout", payment_mode as "paymentMode"
      from generated_stores where site_id = ${siteId} and ${storeScope(businessId)}
    `);
    return store;
  }
  type Reader = Pick<Database, 'execute'>;
  async function logActivity(
    tx: Reader,
    siteId: string,
    actorId: string | undefined,
    kind: string,
    summary: string,
    sourceKey?: string,
  ) {
    await tx.execute(sql`
      insert into generated_store_activity(site_id, actor_id, kind, summary, source_key)
      values (${siteId}::uuid, ${actorId ?? null}::uuid, ${kind}, ${summary}, ${sourceKey ?? null})
      on conflict do nothing
    `);
  }
  async function checkoutStore(tx: Reader, siteId: string) {
    const [store] = await tx.execute<CheckoutStore>(sql`
      select currency, delivery_zones as zones, delivery_revision as "deliveryRevision",
        direct_checkout as "directCheckout",
        payment_mode as "paymentMode",
        (select business_id from workspace_artifacts where id = generated_stores.site_id) as "businessId"
      from generated_stores where site_id = ${siteId} and ${liveScope} for update
    `);
    return store;
  }

  async function checkoutItems(tx: Reader, siteId: string, input: OrderInput) {
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
        return null;
      items.push({
        productId: product.id,
        productName: product.name,
        unitPrice: product.price,
        quantity: item.quantity,
      });
    }
    return items;
  }

  async function checkoutDiscount(
    tx: Reader,
    siteId: string,
    code: string | null,
    subtotal: number,
    lock = false,
  ): Promise<StoreDiscountSnapshot | false> {
    if (!code) return null;
    const [discount] = await tx.execute<{
      percentOff: number;
      maxUses: number | null;
      usedCount: number;
    }>(sql`
      select percent_off as "percentOff", max_uses as "maxUses", used_count as "usedCount"
      from generated_store_discounts
      where site_id = ${siteId} and code = ${code} and active
        and (expires_at is null or expires_at > now())
        and (max_uses is null or used_count < max_uses)
      ${lock ? sql`for update` : sql.empty()}
    `);
    if (!discount) return false;
    const amount = Math.floor((subtotal * discount.percentOff) / 100);
    return amount > 0 ? { code, amount } : false;
  }

  async function consumeDiscount(
    tx: Reader,
    siteId: string,
    discount: StoreDiscountSnapshot,
  ) {
    if (!discount) return true;
    const updated = await tx.execute(sql`
      update generated_store_discounts set used_count = used_count + 1, revision = revision + 1
      where site_id = ${siteId} and code = ${discount.code} and active
        and (expires_at is null or expires_at > now())
        and (max_uses is null or used_count < max_uses)
      returning code
    `);
    return updated.length === 1;
  }

  async function queueStoreEmail(
    tx: Reader,
    siteId: string,
    orderId: string,
    eventKey: string,
    recipient: string,
    subject: string,
    body: string,
  ) {
    await tx.execute(sql`
      insert into generated_store_email_outbox(site_id, order_id, event_key, recipient, subject, body)
      values (${siteId}, ${orderId}, ${eventKey}, ${recipient}, ${subject}, ${body})
      on conflict (site_id, order_id, event_key) do nothing
    `);
  }

  async function savedOrder(
    tx: Reader,
    siteId: string,
    input: OrderInput,
    quoted: boolean,
    direct: boolean,
  ) {
    const [existing] = await tx.execute<{
      email: string;
      reviewed: boolean;
      direct: boolean;
      discountCode: string | null;
    }>(sql`
      select orders.email, orders.delivery is not null as reviewed,
        coalesce(sale.direct_checkout, false) as direct, orders.discount_code as "discountCode"
      from generated_store_orders orders left join stripe_sales sale on sale.id = orders.sale_id
      where orders.site_id = ${siteId} and orders.id = ${input.id}
    `);
    if (!existing) return undefined;
    if (
      existing.email !== input.email ||
      existing.reviewed !== quoted ||
      existing.direct !== direct ||
      existing.discountCode !== input.discountCode
    )
      return false;
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

  async function insertSale(
    tx: Reader,
    businessId: string,
    currency: string,
    items: StoreOrderLine[],
    delivery: StoreDelivery | null,
    discount: StoreDiscountSnapshot,
    direct: boolean,
    paymentMode: 'test' | 'live' = 'test',
  ) {
    const amount = storeOrderTotal(items, delivery, discount?.amount ?? 0);
    const first = items[0];
    const minimum = direct ? (currency === 'GBP' ? 30 : 50) : 1;
    if (!first || amount < minimum || amount > 99_999_999) return null;
    const title =
      items.length === 1
        ? `${first.productName} × ${first.quantity}`
        : `${first.productName} and ${items.length - 1} more`;
    const deadline = direct
      ? sql`date_trunc('second', now()) + interval '45 minutes'`
      : sql`null`;
    const [sale] = await tx.execute<{ id: string }>(sql`
      insert into stripe_sales(id, business_id, mode, account_id, title, currency, amount, direct_checkout, checkout_hold_until, checkout_recover_at)
      select ${randomUUID()}, business_id, ${paymentMode}, account_id, ${title}, ${currency.toLowerCase()}, ${amount}, ${direct},
        ${deadline}, ${deadline}
      from stripe_sellers where business_id = ${businessId} and ${readyStripeSeller(paymentMode)}
      returning id
    `);
    return sale?.id ?? null;
  }

  async function insertOrder(
    tx: Reader,
    siteId: string,
    store: CheckoutStore,
    input: OrderInput,
    items: StoreOrderLine[],
    delivery: StoreDelivery | null,
    discount: StoreDiscountSnapshot,
    direct: boolean,
  ) {
    const first = items[0];
    if (!first || (direct && !store.directCheckout)) return false;
    const saleId = direct
      ? await insertSale(
          tx,
          store.businessId,
          store.currency,
          items,
          delivery,
          discount,
          true,
          store.paymentMode,
        )
      : null;
    if (direct && !saleId) return false;
    await tx.execute(sql`
      insert into generated_store_orders(site_id, id, product_id, product_name, unit_price, currency, quantity, email, delivery, discount_code, discount_amount, status, sale_id)
      values (${siteId}, ${input.id}, ${first.productId}, ${first.productName}, ${first.unitPrice}, ${store.currency}, ${first.quantity}, ${input.email},
        ${delivery ? JSON.stringify(delivery) : null}::jsonb, ${discount?.code ?? null}, ${discount?.amount ?? 0}, ${direct ? 'confirmed' : 'requested'}, ${saleId})
    `);
    const rows = sql.join(
      items.map(
        (item) =>
          sql`(${siteId}, ${input.id}, ${item.productId}, ${item.productName}, ${item.unitPrice}, ${item.quantity})`,
      ),
      sql`,`,
    );
    await tx.execute(sql`
      insert into generated_store_order_lines(site_id, order_id, product_id, product_name, unit_price, quantity) values ${rows}
    `);
    await logActivity(
      tx,
      siteId,
      undefined,
      'order.requested',
      'Received a new customer order.',
      `store-order:${input.id}`,
    );
    const total = storeOrderTotal(items, delivery, discount?.amount ?? 0);
    const summary = items
      .map(
        ({ productName, quantity, unitPrice }) =>
          `${quantity} × ${productName} — ${store.currency} ${((quantity * unitPrice) / 100).toFixed(2)}`,
      )
      .join('\n');
    await queueStoreEmail(
      tx,
      siteId,
      input.id,
      'order_received',
      input.email,
      `Order received · ${input.id.slice(0, 8)}`,
      `We received your order.\n\nReference: ${input.id}\n${summary}${discount ? `\nDiscount ${discount.code}: -${store.currency} ${(discount.amount / 100).toFixed(2)}` : ''}\nTotal: ${store.currency} ${(total / 100).toFixed(2)}\n\nYour payment status will be confirmed separately.`,
    );
    if (direct)
      await tx.execute(sql`
        update generated_store_products products set stock = products.stock - lines.quantity, revision = products.revision + 1
        from generated_store_order_lines lines
        where lines.site_id = ${siteId} and lines.order_id = ${input.id}
          and products.site_id = lines.site_id and products.id = lines.product_id
      `);
    if (!(await consumeDiscount(tx, siteId, discount)))
      throw new Error('Discount redemption changed during order creation.');
    return true;
  }

  return {
    scopedStore,
    async read(businessId: string, siteId: string) {
      const store = await scopedStore(businessId, siteId);
      if (!store) return null;
      const [products, orders, customers, counts, discounts] =
        await Promise.all([
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
          db.execute<StoreOrder>(
            storeOrderRows(sql`orders.site_id = ${siteId}`, 200),
          ),
          db.execute<StoreCustomer>(customerRows(siteId, {}, 200, 'recent')),
          db.execute<{ openRequests: number; awaitingFulfillment: number }>(sql`
          select count(*) filter (where status = 'requested')::int as "openRequests",
            count(*) filter (where orders.status = 'confirmed' and
              (orders.sale_id is null or
                (sale.paid_at is not null and sale.amount_refunded < sale.amount)))::int as "awaitingFulfillment"
          from generated_store_orders orders left join stripe_sales sale on sale.id = orders.sale_id
          where orders.site_id = ${siteId}
        `),
          db.execute<StoreDiscount>(sql`
          select code, percent_off as "percentOff", active,
            max_uses as "maxUses", used_count as "usedCount",
            expires_at as "expiresAt", revision
          from generated_store_discounts where site_id = ${siteId}
          order by created_at desc, code limit 100
        `),
        ]);
      return {
        ...store,
        products,
        orders,
        customers,
        counts: counts[0],
        discounts,
      };
    },
    async merchantOrders(
      businessId: string,
      siteId: string,
      options: z.infer<typeof merchantOrdersQuery>,
    ) {
      if (!(await scopedStore(businessId, siteId))) return null;
      const rows = await db.execute<StoreOrder>(
        storeOrderRows(orderFilter(siteId, options), merchantPageSize + 1),
      );
      const orders = rows.slice(0, merchantPageSize);
      const last = rows.length > merchantPageSize ? orders.at(-1) : undefined;
      return {
        orders,
        next: last ? { before: last.createdAt, id: last.id } : null,
      };
    },
    async merchantEmails(
      businessId: string,
      siteId: string,
      options: z.infer<typeof merchantEmailsQuery>,
    ) {
      if (!(await scopedStore(businessId, siteId))) return null;
      const rows = await db.execute<StoreEmailLog>(sql`
        select id, order_id as "orderId", event_key as event, recipient, state as status,
          attempts, provider_id as "providerId", note, created_at as "createdAt"
        from generated_store_email_outbox where site_id = ${siteId}
          ${options.before && options.id ? sql`and (created_at, id) < (${options.before}::timestamptz, ${options.id}::uuid)` : sql.empty()}
        order by created_at desc, id desc limit ${merchantPageSize + 1}
      `);
      const emails = rows.slice(0, merchantPageSize);
      const last = rows.length > merchantPageSize ? emails.at(-1) : undefined;
      return {
        emails,
        next: last ? { before: last.createdAt, id: last.id } : null,
      };
    },
    async merchantActivity(
      businessId: string,
      siteId: string,
      options: z.infer<typeof merchantActivityQuery>,
    ) {
      if (!(await scopedStore(businessId, siteId))) return null;
      const rows = await db.execute<StoreActivity>(sql`
        select activity.id, activity.kind, activity.summary,
          coalesce(accounts.name, accounts.email) as actor,
          activity.created_at as "createdAt"
        from generated_store_activity activity
        left join accounts on accounts.id = activity.actor_id
        where activity.site_id = ${siteId}
          ${options.before && options.id ? sql`and (activity.created_at, activity.id) < (${options.before}::timestamptz, ${options.id}::uuid)` : sql.empty()}
        order by activity.created_at desc, activity.id desc
        limit ${merchantPageSize + 1}
      `);
      const activity = rows.slice(0, merchantPageSize);
      const last = rows.length > merchantPageSize ? activity.at(-1) : undefined;
      return {
        activity,
        next: last ? { before: last.createdAt, id: last.id } : null,
      };
    },
    async merchantCustomers(
      businessId: string,
      siteId: string,
      options: z.infer<typeof merchantCustomersQuery>,
    ) {
      if (!(await scopedStore(businessId, siteId))) return null;
      const rows = await db.execute<StoreCustomer>(
        customerRows(siteId, options, merchantPageSize + 1, 'email'),
      );
      const customers = rows.slice(0, merchantPageSize);
      const last =
        rows.length > merchantPageSize ? customers.at(-1) : undefined;
      return { customers, next: last ? { after: last.email } : null };
    },
    async merchantReport(
      businessId: string,
      siteId: string,
      range: z.infer<typeof merchantReportQuery>,
    ) {
      const store = await scopedStore(businessId, siteId);
      if (!store) return null;
      const days = await db.execute<StoreReportDay>(
        reportRows(businessId, siteId, range),
      );
      const [usage] = await db.execute<StoreReport['usage']>(sql`
        with build_turns as (
          select distinct turn_id from website_versions
          where artifact_id = ${siteId}::uuid and runtime_mode = 'store' and turn_id is not null
        ), credit_usage as (
          select coalesce(sum(-amount) filter (where kind = 'model'), 0)::text as "modelCredits",
            coalesce(sum(-amount) filter (where kind = 'tool'), 0)::text as "toolCredits",
            coalesce(sum(-amount), 0)::text as "totalCredits"
          from credit_entries where kind in ('model', 'tool')
            and turn_id in (select turn_id from build_turns)
        ) select
          (select count(*)::int from generated_store_products where site_id = ${siteId}::uuid and parent_id is null) as products,
          (select count(*)::int from generated_store_products where site_id = ${siteId}::uuid and parent_id is not null) as variants,
          (select count(*)::int from generated_store_product_photos where site_id = ${siteId}::uuid) as "photoCount",
          coalesce((select sum(octet_length(content)) from generated_store_product_photos where site_id = ${siteId}::uuid), 0)::text as "photoBytes",
          (select count(*)::int from media_jobs where site_id = ${siteId}::uuid and state <> 'failed') as "mediaJobs",
          coalesce((select sum(credits) from media_jobs where site_id = ${siteId}::uuid and state <> 'failed'), 0)::text as "mediaCredits",
          credit_usage."modelCredits", credit_usage."toolCredits", credit_usage."totalCredits"
        from credit_usage`);
      return {
        currency: store.currency,
        mode: range.mode ?? 'test',
        days: Array.from(days),
        usage: usage ?? {
          products: 0,
          variants: 0,
          photoCount: 0,
          photoBytes: '0',
          mediaJobs: 0,
          mediaCredits: '0',
          modelCredits: '0',
          toolCredits: '0',
          totalCredits: '0',
        },
      };
    },
    async saveProduct(
      businessId: string,
      siteId: string,
      input: z.infer<typeof productEdit>,
      actorId?: string,
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
              and ${stock} + coalesce((
                select sum(lines.quantity) from generated_store_order_lines lines
                join generated_store_orders orders on orders.site_id = lines.site_id and orders.id = lines.order_id
                join stripe_sales sale on sale.id = orders.sale_id
                where lines.site_id = ${siteId} and lines.product_id = ${id}
                  and orders.status = 'confirmed' and sale.direct_checkout
              ), 0) <= 1000000
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
        await logActivity(
          tx,
          siteId,
          actorId,
          id ? 'product.updated' : 'product.created',
          `${id ? 'Updated' : 'Added'} product “${name}”.`,
        );
        return true;
      });
    },
    async saveDiscount(
      businessId: string,
      siteId: string,
      raw: z.input<typeof discountEdit>,
      actorId?: string,
    ) {
      const input = discountEdit.parse(raw);
      return db.transaction(async (tx) => {
        const [store] = await tx.execute(sql`
          select site_id from generated_stores
          where site_id = ${siteId} and ${storeScope(businessId)} for update
        `);
        if (!store) return false;
        const saved = input.revision
          ? await tx.execute(sql`
              update generated_store_discounts set percent_off = ${input.percentOff},
                active = ${input.active}, max_uses = ${input.maxUses},
                expires_at = ${input.expiresAt},
                revision = revision + 1
              where site_id = ${siteId} and code = ${input.code} and revision = ${input.revision}
              returning code
            `)
          : await tx.execute(sql`
              insert into generated_store_discounts(site_id, code, percent_off, active, max_uses, expires_at)
              values (${siteId}, ${input.code}, ${input.percentOff}, ${input.active}, ${input.maxUses},
                ${input.expiresAt})
              on conflict do nothing returning code
            `);
        if (!saved.length) return false;
        await logActivity(
          tx,
          siteId,
          actorId,
          input.revision ? 'discount.updated' : 'discount.created',
          `${input.revision ? 'Updated' : 'Added'} discount code ${input.code}.`,
        );
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
      actorId?: string,
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
        if (!result.length) return false;
        await logActivity(
          tx,
          siteId,
          actorId,
          'store.currency',
          `Changed store currency to ${currency}.`,
        );
        return true;
      });
    },
    async setDelivery(
      businessId: string,
      siteId: string,
      revision: number,
      zones: StoreDeliveryZone[],
      actorId?: string,
    ) {
      return db.transaction(async (tx) => {
        const updated = await tx.execute(sql`
          update generated_stores set delivery_zones = ${JSON.stringify(storeDeliveryZones.parse(zones))}::jsonb,
            delivery_revision = delivery_revision + 1
          where site_id = ${siteId} and delivery_revision = ${revision} and ${storeScope(businessId)}
          returning site_id
        `);
        if (!updated.length) return false;
        await logActivity(
          tx,
          siteId,
          actorId,
          'store.delivery',
          'Updated shipping and tax rules.',
        );
        return true;
      });
    },
    async isPublished(siteId: string) {
      const [store] = await db.execute(
        sql`select site_id from generated_stores where site_id = ${siteId} and ${liveScope}`,
      );
      return Boolean(store);
    },
    async catalog(siteId: string) {
      const [store] = await db.execute<{
        currency: string;
        zones: StoreDeliveryZone[];
        title: string;
        paymentMode: 'test' | 'live';
        directCheckout: boolean;
      }>(sql`
        select generated_stores.currency, generated_stores.payment_mode as "paymentMode",
          delivery_zones as zones, coalesce(website_versions.title, 'Store') as title,
          direct_checkout and exists (
            select 1 from stripe_sellers where business_id = site.business_id
              and mode = generated_stores.payment_mode
              and details_submitted and charges_enabled and payouts_enabled
          ) as "directCheckout"
        from generated_stores join workspace_artifacts site on site.id = generated_stores.site_id
        join website_publications on website_publications.artifact_id = generated_stores.site_id
          and website_publications.unpublished_at is null
          and website_publications.draft_revision >= generated_stores.first_revision
        left join website_versions on website_versions.artifact_id = generated_stores.site_id
          and website_versions.revision = website_publications.draft_revision
        where generated_stores.site_id = ${siteId}
          and website_versions.runtime_mode = 'store'
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
    async setCheckout(
      businessId: string,
      siteId: string,
      enabled: boolean,
      actorId?: string,
    ) {
      return db.transaction(async (tx) => {
        const [store] = await tx.execute(sql`
          update generated_stores set direct_checkout = ${enabled}
          where site_id = ${siteId} and ${storeScope(businessId)} returning site_id
        `);
        if (!store) return false;
        await logActivity(
          tx,
          siteId,
          actorId,
          'store.checkout',
          `${enabled ? 'Enabled' : 'Disabled'} direct checkout.`,
        );
        return true;
      });
    },
    async setPaymentMode(
      businessId: string,
      siteId: string,
      mode: 'test' | 'live',
      actorId?: string,
    ) {
      return db.transaction(async (tx) => {
        const [store] = await tx.execute(sql`
          update generated_stores set payment_mode = ${mode}
          where site_id = ${siteId} and ${storeScope(businessId)} returning site_id
        `);
        if (!store) return false;
        await logActivity(
          tx,
          siteId,
          actorId,
          'store.payment_mode',
          `Changed checkout mode to ${mode}.`,
        );
        return true;
      });
    },
    async buyerSale(siteId: string, orderId: string) {
      const [order] = await db.execute<{ id: string; paid: boolean }>(sql`
        select sale.id, sale.paid_at is not null as paid
        from generated_store_orders orders join stripe_sales sale on sale.id = orders.sale_id
        where orders.site_id = ${siteId} and orders.id = ${orderId}
          and sale.direct_checkout and sale.closed_at is null
      `);
      return order;
    },
    async request(
      siteId: string,
      raw: z.input<typeof orderRequest>,
      direct = false,
      expectedPaymentMode?: 'test' | 'live',
    ) {
      const input = orderRequest.parse(raw);
      return db.transaction(async (tx) => {
        const store = await checkoutStore(tx, siteId);
        if (
          !store ||
          (direct &&
            expectedPaymentMode &&
            store.paymentMode !== expectedPaymentMode)
        )
          return false;
        const previous = await savedOrder(tx, siteId, input, false, direct);
        if (previous !== undefined) return previous;
        if (store.zones.length) return false;
        const items = await checkoutItems(tx, siteId, input);
        if (!items) return false;
        const discount = await checkoutDiscount(
          tx,
          siteId,
          input.discountCode,
          storeOrderTotal(items),
          true,
        );
        if (discount === false) return false;
        return insertOrder(
          tx,
          siteId,
          store,
          input,
          items,
          null,
          discount,
          direct,
        );
      });
    },
    async prepareDelivery(
      siteId: string,
      raw: z.input<typeof orderRequest>,
      address: StoreDeliveryAddress,
      buyer: string | null,
    ) {
      const input = { ...orderRequest.parse(raw), id: randomUUID() };
      return db.transaction(async (tx) => {
        const store = await checkoutStore(tx, siteId);
        if (!store) return null;
        const zone = store.zones.find(
          ({ country }) => country === address.country,
        );
        if (!zone || (buyer && buyer !== input.email)) return null;
        const items = await checkoutItems(tx, siteId, input);
        if (!items) return null;
        const subtotal = storeOrderTotal(items);
        const discount = await checkoutDiscount(
          tx,
          siteId,
          input.discountCode,
          subtotal,
        );
        if (discount === false) return null;
        const discountAmount = discount?.amount ?? 0;
        const discountedSubtotal = subtotal - discountAmount;
        const shipping =
          zone.freeAbove !== null && discountedSubtotal >= zone.freeAbove
            ? 0
            : zone.shipping;
        const taxable = discountedSubtotal + (zone.taxShipping ? shipping : 0);
        const tax = Math.floor((taxable * zone.taxRate + 5000) / 10000);
        const delivery = { address, shipping, tax };
        const snapshot = { items, delivery, discount };
        const id = input.id;
        await tx.execute(sql`
          delete from generated_store_delivery_quotes where (site_id, id) in (
            select site_id, id from generated_store_delivery_quotes where expires_at <= now() limit 200 for update skip locked
          )
        `);
        await tx.execute(sql`
          insert into generated_store_delivery_quotes(site_id, id, input, snapshot, buyer_email, delivery_revision, currency, expires_at)
          values (${siteId}, ${id}, ${JSON.stringify(input)}::jsonb, ${JSON.stringify(snapshot)}::jsonb, ${buyer},
            ${store.deliveryRevision}, ${store.currency}, now() + interval '15 minutes')
        `);
        return {
          id,
          email: input.email,
          currency: store.currency,
          ...snapshot,
        };
      });
    },
    async placeDelivery(
      siteId: string,
      quoteId: string,
      buyer: string | null,
      direct = false,
      expectedPaymentMode?: 'test' | 'live',
    ) {
      return db.transaction(async (tx) => {
        const store = await checkoutStore(tx, siteId);
        if (
          !store ||
          (direct &&
            expectedPaymentMode &&
            store.paymentMode !== expectedPaymentMode)
        )
          return null;
        const [quote] = await tx.execute<CheckoutQuote>(sql`
          select id, input, snapshot, buyer_email, delivery_revision, currency
          from generated_store_delivery_quotes where id = ${quoteId} and site_id = ${siteId} and expires_at > now()
        `);
        if (
          !quote ||
          (quote.buyer_email !== null && quote.buyer_email !== buyer) ||
          (buyer !== null && buyer !== quote.input.email)
        )
          return null;
        const { input, snapshot } = quote;
        const previous = await savedOrder(tx, siteId, input, true, direct);
        if (previous !== undefined) return previous ? input.id : null;
        if (
          quote.delivery_revision !== store.deliveryRevision ||
          quote.currency !== store.currency
        )
          return null;
        const items = await checkoutItems(tx, siteId, input);
        if (
          !items ||
          items.some(
            (item, i) =>
              item.unitPrice !== snapshot.items[i]?.unitPrice ||
              item.productName !== snapshot.items[i]?.productName,
          )
        )
          return null;
        const discount = await checkoutDiscount(
          tx,
          siteId,
          input.discountCode,
          storeOrderTotal(items),
          true,
        );
        if (
          discount === false ||
          JSON.stringify(discount) !== JSON.stringify(snapshot.discount)
        )
          return null;
        const saved = await insertOrder(
          tx,
          siteId,
          store,
          input,
          items,
          snapshot.delivery,
          discount,
          direct,
        );
        return saved ? input.id : null;
      });
    },
    async createPayment(
      businessId: string,
      siteId: string,
      id: string,
      actorId?: string,
    ) {
      return db.transaction(async (tx) => {
        const [store] = await tx.execute<{ paymentMode: 'test' | 'live' }>(sql`
          select payment_mode as "paymentMode" from generated_stores
          where site_id = ${siteId} and ${storeScope(businessId)} for update
        `);
        if (!store) return null;
        const [order] = await tx.execute<{
          sale_id: string | null;
          currency: string;
          delivery: StoreDelivery | null;
          discount_code: string | null;
          discount_amount: number;
        }>(sql`
          select sale_id, currency, delivery, discount_code, discount_amount
          from generated_store_orders
          where site_id = ${siteId} and id = ${id} and status = 'confirmed'
        `);
        if (!order) return null;
        if (order.sale_id) return order.sale_id;
        const lines = await tx.execute<StoreOrderLine>(sql`
          select product_id as "productId", product_name as "productName", unit_price as "unitPrice", quantity
          from generated_store_order_lines where site_id = ${siteId} and order_id = ${id}
          order by product_name, product_id
        `);
        const saleId = await insertSale(
          tx,
          businessId,
          order.currency,
          lines,
          order.delivery,
          order.discount_code
            ? { code: order.discount_code, amount: order.discount_amount }
            : null,
          false,
          store.paymentMode,
        );
        if (!saleId) return null;
        await tx.execute(sql`
          update generated_store_orders set sale_id = ${saleId} where site_id = ${siteId} and id = ${id}
        `);
        await logActivity(
          tx,
          siteId,
          actorId,
          'order.payment_link',
          `Created a payment link for order ${id.slice(0, 8)}.`,
        );
        return saleId;
      });
    },
    async changeOrder(
      businessId: string,
      siteId: string,
      id: string,
      status: z.infer<typeof orderAction>,
      tracking?: z.infer<typeof fulfillmentTracking>,
      actorId?: string,
    ) {
      if (tracking && status !== 'fulfilled') return false;
      return db.transaction(async (tx) => {
        const [store] = await tx.execute(sql`
          select site_id from generated_stores where site_id = ${siteId} and ${storeScope(businessId)} for update
        `);
        if (!store) return false;
        const [order] = await tx.execute<{
          status: StoreOrder['status'];
          email: string;
          sale_id: string | null;
          tracking_carrier: string | null;
          tracking_number: string | null;
          tracking_url: string | null;
        }>(sql`
          select status, email, sale_id, tracking_carrier, tracking_number, tracking_url
          from generated_store_orders
          where site_id = ${siteId} and id = ${id}
        `);
        if (!order) return false;
        if (order.status === status) {
          if (!tracking || status !== 'fulfilled') return true;
          if (
            order.tracking_carrier === tracking.carrier &&
            order.tracking_number === tracking.number &&
            order.tracking_url === tracking.url
          )
            return true;
          await tx.execute(sql`
            update generated_store_orders set tracking_carrier = ${tracking.carrier},
              tracking_number = ${tracking.number}, tracking_url = ${tracking.url}
            where site_id = ${siteId} and id = ${id} and status = 'fulfilled'
          `);
          await queueStoreEmail(
            tx,
            siteId,
            id,
            `tracking:${tracking.carrier}:${tracking.number}:${tracking.url}`,
            order.email,
            `Order fulfilled · ${id.slice(0, 8)}`,
            `Your order ${id} has been marked fulfilled.\n\nCarrier: ${tracking.carrier}\nTracking number: ${tracking.number}\nTrack your order: ${tracking.url}`,
          );
          await logActivity(
            tx,
            siteId,
            actorId,
            'order.tracking',
            `Updated tracking for order ${id.slice(0, 8)}.`,
          );
          return true;
        }
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
        await tx.execute(sql`
          update generated_store_orders set status = ${status},
            tracking_carrier = ${tracking?.carrier ?? null},
            tracking_number = ${tracking?.number ?? null},
            tracking_url = ${tracking?.url ?? null}
          where site_id = ${siteId} and id = ${id}
        `);
        await logActivity(
          tx,
          siteId,
          actorId,
          `order.${status}`,
          `${status === 'confirmed' ? 'Confirmed' : status === 'fulfilled' ? 'Fulfilled' : 'Cancelled'} order ${id.slice(0, 8)}.`,
        );
        if (status === 'fulfilled' || status === 'cancelled') {
          const eventKey =
            status === 'cancelled'
              ? 'cancelled'
              : tracking
                ? `tracking:${tracking.carrier}:${tracking.number}:${tracking.url}`
                : 'fulfilled';
          await queueStoreEmail(
            tx,
            siteId,
            id,
            eventKey,
            order.email,
            status === 'cancelled'
              ? `Order cancelled · ${id.slice(0, 8)}`
              : `Order fulfilled · ${id.slice(0, 8)}`,
            status === 'cancelled'
              ? `Your order ${id} has been cancelled. Contact the store if you need help.`
              : `Your order ${id} has been marked fulfilled.${tracking ? `\n\nCarrier: ${tracking.carrier}\nTracking number: ${tracking.number}\nTrack your order: ${tracking.url}` : ''}`,
          );
        }
        return true;
      });
    },
  };
}
