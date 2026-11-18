import { z } from 'zod';

export const storeCurrency = z.enum(['AUD', 'USD', 'EUR', 'GBP', 'CAD', 'NZD']);
export const storeProductInput = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1500),
  price: z.number().int().min(1).max(100_000_000),
  stock: z.number().int().min(0).max(1_000_000),
  active: z.boolean(),
});
export const storeOrderStatus = z.enum([
  'requested',
  'confirmed',
  'fulfilled',
  'cancelled',
]);

export type StoreProduct = z.infer<typeof storeProductInput> & {
  id: string;
  revision: number;
  parentId?: string | null;
  sku?: string | null;
  photoAlt?: string | null;
};
export type StoreOrderLine = {
  productId: string;
  productName: string;
  unitPrice: number;
  quantity: number;
};
export type StoreOrder = {
  id: string;
  email: string;
  items: StoreOrderLine[];
  delivery: StoreDelivery | null;
  currency: z.infer<typeof storeCurrency>;
  status: z.infer<typeof storeOrderStatus>;
  saleId: string | null;
  payment:
    | 'awaiting_payment'
    | 'paid'
    | 'partially_refunded'
    | 'refunded'
    | 'closed'
    | null;
  createdAt: string;
};

export type StoreCustomer = {
  email: string;
  orderCount: number;
  lastOrderAt: string | null;
  joinedAt: string | null;
};

export const deliveryCountry = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/u)
  .refine(
    (country) =>
      new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' }).of(
        country,
      ) !== undefined && country !== 'ZZ',
  );
export const storeDeliveryZones = z
  .array(
    z.object({
      country: deliveryCountry,
      shipping: z.int().min(0).max(100_000_000),
      freeAbove: z.int().min(1).max(100_000_000).nullable(),
      taxRate: z.int().min(0).max(10000),
      taxShipping: z.boolean(),
    }),
  )
  .max(50)
  .refine(
    (zones) =>
      new Set(zones.map(({ country }) => country)).size === zones.length,
    {
      message: 'Set one delivery rule per country.',
    },
  );
export const storeDeliveryAddress = z.object({
  country: deliveryCountry,
  name: z.string().trim().min(1).max(120),
  street: z.string().trim().min(1).max(180),
  unit: z.string().trim().max(120),
  city: z.string().trim().min(1).max(100),
  region: z.string().trim().max(100),
  postalCode: z.string().trim().max(24),
});
export type StoreDeliveryZone = z.infer<typeof storeDeliveryZones>[number];
export type StoreDeliveryAddress = z.infer<typeof storeDeliveryAddress>;
export type StoreDelivery = {
  address: StoreDeliveryAddress;
  shipping: number;
  tax: number;
};

export function storeOrderTotal(
  items: StoreOrderLine[],
  delivery: StoreDelivery | null = null,
) {
  return (
    items.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0) +
    (delivery ? delivery.shipping + delivery.tax : 0)
  );
}

export type StoreReportDay = {
  day: string;
  requests: number;
  cancelled: number;
  paidOrders: number;
  gross: string;
  refunds: string;
};

export type StoreReport = {
  currency: z.infer<typeof storeCurrency>;
  days: StoreReportDay[];
};
