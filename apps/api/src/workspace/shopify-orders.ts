import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, eq, lte, sql } from 'drizzle-orm';
import {
  numeric,
  boolean,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Database } from '../db/database';
import { businesses } from '../db/schema';
import { vaultCipher } from './vault';

const connections = pgTable('shopify_connections', {
  id: uuid().primaryKey().defaultRandom(),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id, { onDelete: 'cascade' }),
  shop: text().notNull().unique(),
  credentials: text(),
  connectedAt: timestamp('connected_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
const orders = pgTable(
  'shopify_orders',
  {
    connectionId: uuid('connection_id').notNull(),
    id: text().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    status: text(),
    cancelled: boolean().notNull(),
    currency: text().notNull(),
    value: numeric({ precision: 24, scale: 8 }).notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    grossReceived: numeric('gross_received', { precision: 24, scale: 8 }),
    amountRefunded: numeric('amount_refunded', { precision: 24, scale: 8 }),
    customerKey: text('customer_key'),
  },
  (table) => [primaryKey({ columns: [table.connectionId, table.id] })],
);
const deliveries = pgTable(
  'shopify_deliveries',
  {
    connectionId: uuid('connection_id').notNull(),
    eventId: text('event_id').notNull(),
  },
  (table) => [primaryKey({ columns: [table.connectionId, table.eventId] })],
);

const shopDomain = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/u);
const secrets = z.object({
  token: z.string().min(10).max(512),
  secret: z.string().min(16).max(512),
});
export const shopifyConnectionInput = secrets.extend({ shop: shopDomain });
const money = z.object({
  shopMoney: z.object({
    amount: z.string().regex(/^\d{1,16}(?:\.\d{1,8})?$/u),
    currencyCode: z.string().regex(/^[A-Z]{3}$/u),
  }),
});
const outboundOrder = z.object({
  id: z.string().regex(/^gid:\/\/shopify\/Order\/\d+$/u),
  updatedAt: z.iso.datetime({ offset: true }),
  displayFinancialStatus: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  currentTotalPriceSet: money,
  processedAt: z.iso.datetime({ offset: true }).optional(),
  totalReceivedSet: money.optional(),
  totalRefundedSet: money.optional(),
  customer: z
    .object({ id: z.string().regex(/^gid:\/\/shopify\/Customer\/\d+$/u) })
    .nullish(),
});

export const shopQuery = 'query BrightworkShop { shop { myshopifyDomain } }';
export const orderQuery =
  'query BrightworkOrder($id: ID!) { order(id: $id) { id updatedAt processedAt displayFinancialStatus cancelledAt customer { id } currentTotalPriceSet { shopMoney { amount currencyCode } } totalReceivedSet { shopMoney { amount currencyCode } } totalRefundedSet { shopMoney { amount currencyCode } } } }';
const orderTopics = new Set([
  'orders/create',
  'orders/updated',
  'orders/cancelled',
  'orders/paid',
]);

export function shopifyOrders(
  db: Database,
  hexKey: string,
  transport: typeof fetch = fetch,
) {
  const cipher = vaultCipher(hexKey);
  const context = (businessId: string, shop: string) =>
    Buffer.from(businessId + '\0shopify\0' + shop);
  async function admin(
    shop: string,
    token: string,
    query: string,
    variables?: object,
  ) {
    const response = await transport(
      'https://' + shop + '/admin/api/2026-10/graphql.json',
      {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(3_500),
        headers: {
          'X-Shopify-Access-Token': token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, variables }),
      },
    );
    if (!response.ok) throw new Error('Shopify Admin API request failed');
    return z
      .object({ data: z.unknown(), errors: z.array(z.unknown()).optional() })
      .parse(await response.json());
  }
  return {
    async connect(
      businessId: string,
      input: z.infer<typeof shopifyConnectionInput>,
    ) {
      const { data, errors } = await admin(input.shop, input.token, shopQuery);
      const deployment = z
        .object({ shop: z.object({ myshopifyDomain: shopDomain }) })
        .safeParse(data);
      if (
        errors?.length ||
        !deployment.success ||
        deployment.data.shop.myshopifyDomain !== input.shop
      )
        return null;
      const sealed = cipher.seal(
        JSON.stringify({ token: input.token, secret: input.secret }),
        context(businessId, input.shop),
      );
      const [row] = await db
        .insert(connections)
        .values({ businessId, shop: input.shop, credentials: sealed })
        .onConflictDoUpdate({
          target: connections.shop,
          set: { credentials: sealed, connectedAt: new Date() },
          setWhere: eq(connections.businessId, businessId),
        })
        .returning({ id: connections.id });
      return row ?? null;
    },
    async disconnect(businessId: string, id: string) {
      const [row] = await db
        .update(connections)
        .set({ credentials: null })
        .where(
          and(eq(connections.businessId, businessId), eq(connections.id, id)),
        )
        .returning({ id: connections.id });
      return Boolean(row);
    },
    async report(businessId: string) {
      const [shops, totals] = await Promise.all([
        db
          .select({
            id: connections.id,
            shop: connections.shop,
            connected: sql<boolean>`${connections.credentials} is not null`,
          })
          .from(connections)
          .where(eq(connections.businessId, businessId)),
        db
          .select({
            shop: connections.shop,
            currency: orders.currency,
            orders: sql<number>`count(*)::int`,
            orderValue: sql<string>`sum(${orders.value})::text`,
          })
          .from(orders)
          .innerJoin(connections, eq(connections.id, orders.connectionId))
          .where(
            and(
              eq(connections.businessId, businessId),
              eq(orders.cancelled, false),
              eq(orders.status, 'PAID'),
            ),
          )
          .groupBy(connections.shop, orders.currency),
      ]);
      return { shops, totals };
    },
    register(app: FastifyInstance) {
      app.register(async (scope) => {
        scope.removeContentTypeParser('application/json');
        scope.addContentTypeParser(
          'application/json',
          { parseAs: 'buffer', bodyLimit: 512_000 },
          (_request, raw, done) => done(null, raw),
        );
        scope.post(
          '/api/webhooks/shopify/:connection',
          async (request, reply) => {
            const params = z
              .object({ connection: z.uuid() })
              .safeParse(request.params);
            if (!params.success || !Buffer.isBuffer(request.body))
              return reply
                .code(400)
                .send({ message: 'Invalid Shopify delivery.' });
            const connectionId = params.data.connection;
            try {
              const [entry] = await db
                .select()
                .from(connections)
                .where(eq(connections.id, connectionId));
              if (!entry?.credentials)
                return reply
                  .code(404)
                  .send({ message: 'Shopify connection unavailable.' });
              const sealed = entry.credentials;
              const connection = secrets.parse(
                JSON.parse(
                  cipher.open(sealed, context(entry.businessId, entry.shop)),
                ),
              );
              const signature = request.headers['x-shopify-hmac-sha256'];
              const actual =
                typeof signature === 'string' &&
                /^[A-Za-z0-9+/]{43}=$/u.test(signature)
                  ? Buffer.from(signature, 'base64')
                  : null;
              if (
                !actual ||
                !timingSafeEqual(
                  createHmac('sha256', connection.secret)
                    .update(request.body)
                    .digest(),
                  actual,
                ) ||
                request.headers['x-shopify-shop-domain'] !== entry.shop
              )
                return reply
                  .code(401)
                  .send({ message: 'Invalid Shopify signature.' });
              const topic = request.headers['x-shopify-topic'];
              if (typeof topic !== 'string' || !orderTopics.has(topic))
                return { received: true };
              const delivery = z
                .string()
                .min(1)
                .max(200)
                .safeParse(request.headers['x-shopify-webhook-id']);
              let payload: unknown;
              try {
                payload = JSON.parse(request.body.toString());
              } catch {
                return reply
                  .code(400)
                  .send({ message: 'Invalid Shopify order delivery.' });
              }
              const incoming = z
                .object({
                  admin_graphql_api_id: z
                    .string()
                    .regex(/^gid:\/\/shopify\/Order\/\d+$/u),
                })
                .safeParse(payload);
              if (!delivery.success || !incoming.success)
                return reply
                  .code(400)
                  .send({ message: 'Invalid Shopify order delivery.' });
              const eventId = delivery.data;
              const seen = and(
                eq(deliveries.connectionId, connectionId),
                eq(deliveries.eventId, eventId),
              );
              if ((await db.select().from(deliveries).where(seen)).length)
                return { received: true };
              const id = incoming.data.admin_graphql_api_id;
              let result = await admin(
                entry.shop,
                connection.token,
                orderQuery,
                { id },
              );
              if (
                result.errors?.length &&
                result.errors.every(
                  (error) =>
                    z.object({ path: z.array(z.unknown()) }).safeParse(error)
                      .data?.path[1] === 'customer',
                )
              )
                result = await admin(
                  entry.shop,
                  connection.token,
                  orderQuery.replace('customer { id } ', ''),
                  { id },
                );
              if (result.errors?.length)
                throw new Error('Shopify could not resolve the order');
              const order = z
                .object({ order: outboundOrder.nullable() })
                .parse(result.data).order;
              if (order?.id === id)
                await db.transaction(async (tx) => {
                  const [active] = await tx
                    .select({ id: connections.id })
                    .from(connections)
                    .where(
                      and(
                        eq(connections.id, connectionId),
                        eq(connections.credentials, sealed),
                      ),
                    )
                    .for('share');
                  if (!active) return;
                  const [created] = await tx
                    .insert(deliveries)
                    .values({ connectionId, eventId })
                    .onConflictDoNothing()
                    .returning();
                  if (!created) return;
                  const gross = order.totalReceivedSet?.shopMoney;
                  const refund = order.totalRefundedSet?.shopMoney;
                  const currency =
                    order.currentTotalPriceSet.shopMoney.currencyCode;
                  const customerId = order.customer?.id;
                  const values = {
                    updatedAt: new Date(order.updatedAt),
                    status: order.displayFinancialStatus,
                    cancelled: Boolean(order.cancelledAt),
                    currency,
                    processedAt: order.processedAt
                      ? new Date(order.processedAt)
                      : null,
                    grossReceived:
                      gross?.currencyCode === currency ? gross.amount : null,
                    amountRefunded:
                      refund?.currencyCode === currency ? refund.amount : null,
                    customerKey: customerId
                      ? createHmac('sha256', hexKey)
                          .update(
                            'shopify-customer\0' +
                              entry.businessId +
                              '\0' +
                              connectionId +
                              '\0' +
                              customerId,
                          )
                          .digest('hex')
                      : null,
                    value: order.currentTotalPriceSet.shopMoney.amount,
                  };
                  await tx
                    .insert(orders)
                    .values({ connectionId, id, ...values })
                    .onConflictDoUpdate({
                      target: [orders.connectionId, orders.id],
                      set: {
                        ...values,
                        customerKey: sql`coalesce(excluded.customer_key, ${orders.customerKey})`,
                      },
                      setWhere: lte(orders.updatedAt, values.updatedAt),
                    });
                });
              return { received: true };
            } catch {
              request.log.warn('Shopify order processing deferred');
              return reply
                .code(503)
                .send({ message: 'Shopify order processing will retry.' });
            }
          },
        );
      });
    },
  };
}
