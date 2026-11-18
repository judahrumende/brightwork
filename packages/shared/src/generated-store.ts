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
