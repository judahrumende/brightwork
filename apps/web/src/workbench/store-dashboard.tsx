import { StoreListFilters, StoreListPagination } from './store-list-controls';
import { StoreReport } from './store-report';
import { StoreDeliverySettings } from './store-delivery-settings';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  storeCurrency,
  storeOrderTotal,
  storeOrderStatus,
} from '@brightwork/shared';
import type {
  StoreCustomer,
  StoreDeliveryZone,
  StoreOrder,
  StoreProduct,
} from '@brightwork/shared';
import { api, errorMessage, write } from '../auth/client';
import { Button, Pill, Segmented } from '../ui/primitives';
import styles from './store-dashboard.module.css';

type Dashboard = {
  currency: string;
  products: StoreProduct[];
  counts: { openRequests: number; awaitingFulfillment: number };
  paymentReady?: boolean;
  directCheckout?: boolean;
  zones?: StoreDeliveryZone[];
  deliveryRevision?: number;
};
const sections = [
  'Overview',
  'Products',
  'Orders',
  'Customers',
  'Delivery',
  'Report',
] as const;
const paymentLabels = {
  awaiting_payment: 'Awaiting payment',
  paid: 'Paid',
  partially_refunded: 'Partially refunded',
  refunded: 'Refunded',
  closed: 'Checkout closed',
};
const blank = { name: '', description: '', price: 0, stock: 0, active: true };
type ProductEdit = { product?: StoreProduct; parent?: StoreProduct };

function readPhoto(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Photo unreadable.'));
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('Photo unreadable.'));
    reader.readAsDataURL(file);
  });
}

export function StoreDashboard({
  endpoint,
  publicUrl,
  readOnly,
}: {
  endpoint: string;
  publicUrl: string | null;
  readOnly: boolean;
}) {
  const cache = useQueryClient();
  const [section, setSection] = useState<string>('Overview');
  const query = useQuery({
    queryKey: ['store-dashboard', endpoint],
    queryFn: ({ signal }) => api<Dashboard>(endpoint, { signal }),
  });
  const [orderSearch, setOrderSearch] = useState<Record<string, string>>({});
  const [customerSearch, setCustomerSearch] = useState<Record<string, string>>(
    {},
  );
  const [orderPages, setOrderPages] = useState<Record<string, string>[]>([{}]);
  const [customerPages, setCustomerPages] = useState<Record<string, string>[]>([
    {},
  ]);
  const orderParams = new URLSearchParams({
    ...orderSearch,
    ...orderPages.at(-1),
  }).toString();
  const customerParams = new URLSearchParams({
    ...customerSearch,
    ...customerPages.at(-1),
  }).toString();
  const orders = useQuery({
    queryKey: ['store-data', endpoint, 'orders', orderParams],
    queryFn: ({ signal }) =>
      api<{ orders: StoreOrder[]; next: Record<string, string> | null }>(
        endpoint + '/orders?' + orderParams,
        { signal },
      ),
    enabled: section === 'Orders',
    refetchInterval: ({ state }) =>
      state.data?.orders.some((order) => order.payment === 'awaiting_payment')
        ? 5000
        : false,
  });
  const customers = useQuery({
    queryKey: ['store-data', endpoint, 'customers', customerParams],
    queryFn: ({ signal }) =>
      api<{ customers: StoreCustomer[]; next: Record<string, string> | null }>(
        endpoint + '/customers?' + customerParams,
        { signal },
      ),
    enabled: section === 'Customers',
  });
  const [editing, setEditing] = useState<ProductEdit | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  async function save(body: object) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await write(endpoint, body);
      setEditing(null);
      await Promise.all([
        query.refetch(),
        cache.invalidateQueries({ queryKey: ['store-data', endpoint] }),
      ]);
      setNotice('Saved.');
    } catch (failure) {
      setError(errorMessage(failure));
      await Promise.all([
        query.refetch(),
        cache.invalidateQueries({ queryKey: ['store-data', endpoint] }),
      ]);
    } finally {
      setBusy(false);
    }
  }
  if (query.isPending) return <p role="status">Loading store…</p>;
  const store = query.data;
  if (!store) return <p role="alert">{errorMessage(query.error)}</p>;
  const money = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: store.currency,
  });
  const current = editing ? (editing.product ?? blank) : null;
  const parents = new Set(
    store.products.flatMap(({ parentId }) => (parentId ? [parentId] : [])),
  );
  const group = Boolean(editing?.product && parents.has(editing.product.id));
  const variant = Boolean(editing?.parent || editing?.product?.parentId);
  const photoAlt = editing?.product?.photoAlt;
  function photoUrl(product: StoreProduct) {
    return endpoint + '/photos/' + product.id + '?revision=' + product.revision;
  }

  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !editing) return;
    const data = new FormData(event.currentTarget);
    const previous = editing.product;
    const image = data.get('photo');
    const alt = String(data.get('photoAlt') ?? '').trim();
    const remove = data.has('removePhoto');
    let photo: { data: string; alt: string } | null | undefined;
    if (image instanceof File && image.size) {
      if (
        !['image/png', 'image/jpeg', 'image/webp'].includes(image.type) ||
        image.size > 512 * 1024
      ) {
        setError('Choose a PNG, JPEG or WebP photo up to 512 KB.');
        return;
      }
      if (!alt) {
        setError(
          'Describe the photo so shoppers using a screen reader know what it shows.',
        );
        return;
      }
      setBusy(true);
      try {
        photo = { data: await readPhoto(image), alt };
      } catch {
        setError('Could not read the photo.');
        setBusy(false);
        return;
      }
    } else if (remove) {
      photo = null;
    }
    const sku = String(data.get('sku') ?? '').trim();
    const product = {
      ...(previous ? { id: previous.id, revision: previous.revision } : {}),
      ...(editing.parent ? { parentId: editing.parent.id } : {}),
      ...(sku || previous?.sku ? { sku } : {}),
      ...(photo !== undefined ? { photo } : {}),
      ...(photo === undefined && photoAlt && alt !== photoAlt && alt
        ? { photoAlt: alt }
        : {}),
      name: String(data.get('name')),
      description: String(data.get('description')),
      price:
        group && previous
          ? previous.price
          : Math.round(Number(data.get('price')) * 100),
      stock: group && previous ? previous.stock : Number(data.get('stock')),
      active: data.has('active'),
    };
    await save({ action: 'product', product });
  }
  const counts = [
    {
      label: 'Active products',
      value: store.products.filter(
        ({ active, parentId }) => active && !parentId,
      ).length,
    },
    {
      label: 'Open requests',
      value: store.counts.openRequests,
    },
    {
      label: 'Awaiting fulfillment',
      value: store.counts.awaitingFulfillment,
    },
  ];

  return (
    <section className={styles.dashboard} aria-label="Store dashboard">
      <div className={styles.toolbar}>
        <Segmented
          label="Store dashboard sections"
          options={sections.map((value) => ({ value, label: value }))}
          value={section}
          onValueChange={(value) => {
            setSection(value);
            setEditing(null);
            setNotice('');
            setError('');
          }}
        />
        {publicUrl && (
          <a
            href={new URL('/store/catalog', publicUrl).href}
            target="_blank"
            rel="noreferrer"
          >
            Open catalog ↗
          </a>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {section === 'Overview' && (
        <>
          <dl className={styles.metrics}>
            {counts.map(({ label, value }) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {!publicUrl && (
            <p>The catalog opens to shoppers after you publish the site.</p>
          )}
          <p>Store currency · {store.currency}</p>
          <div>
            <h3>Stripe test checkout</h3>
            <p>
              {store.directCheckout && store.paymentReady
                ? 'Shoppers can pay directly from the catalog in test mode.'
                : 'Shoppers can submit an order request for you to review.'}
            </p>
            {!readOnly && (store.paymentReady || store.directCheckout) && (
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void save({
                    action: 'checkout',
                    enabled: !store.directCheckout,
                  })
                }
              >
                {store.directCheckout
                  ? 'Turn off test checkout'
                  : 'Enable test checkout'}
              </Button>
            )}
          </div>
          {!readOnly && !store.products.length && (
            <label>
              Currency{' '}
              <select
                value={store.currency}
                disabled={busy}
                onChange={(event) =>
                  void save({
                    action: 'currency',
                    currency: event.target.value,
                  })
                }
              >
                {storeCurrency.options.map((currency) => (
                  <option key={currency}>{currency}</option>
                ))}
              </select>
            </label>
          )}
        </>
      )}
      {section === 'Products' && (
        <>
          <div className={styles.toolbar}>
            <h3>Products</h3>
            {!readOnly && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setEditing({})}
              >
                Add product
              </Button>
            )}
          </div>
          {current && (
            <form
              className={styles.form}
              key={editing?.product?.id ?? editing?.parent?.id ?? 'new'}
              onSubmit={(event) => void saveProduct(event)}
            >
              {editing?.parent && <h4>Add variant to {editing.parent.name}</h4>}
              <label>
                {variant ? 'Variant name' : 'Name'}
                <input
                  name="name"
                  required
                  maxLength={120}
                  defaultValue={current.name}
                />
              </label>
              <label>
                Description
                <textarea
                  name="description"
                  maxLength={1500}
                  defaultValue={current.description}
                />
              </label>
              {!group && (
                <>
                  <label>
                    Price ({store.currency})
                    <input
                      name="price"
                      type="number"
                      required
                      min="0.01"
                      max="1000000"
                      step="0.01"
                      defaultValue={
                        current.price ? current.price / 100 : undefined
                      }
                    />
                  </label>
                  <label>
                    Stock
                    <input
                      name="stock"
                      type="number"
                      required
                      min="0"
                      max="1000000"
                      defaultValue={current.stock}
                    />
                  </label>
                </>
              )}
              <label>
                SKU
                <input
                  name="sku"
                  maxLength={80}
                  defaultValue={editing?.product?.sku ?? ''}
                />
              </label>
              {photoAlt && editing?.product && (
                <img
                  className={styles.productPhoto}
                  src={photoUrl(editing.product)}
                  alt={photoAlt}
                />
              )}
              <label>
                Product photo
                <input
                  name="photo"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                />
              </label>
              <label>
                Photo description
                <input
                  name="photoAlt"
                  maxLength={160}
                  defaultValue={photoAlt ?? ''}
                />
              </label>
              {photoAlt && (
                <label>
                  <input type="checkbox" name="removePhoto" /> Remove current
                  photo
                </label>
              )}
              <label>
                <input
                  type="checkbox"
                  name="active"
                  defaultChecked={current.active}
                />{' '}
                Show in catalog
              </label>
              <div className={styles.toolbar}>
                <Button type="submit" disabled={busy}>
                  Save product
                </Button>
                <Button
                  type="button"
                  variant="quiet"
                  onClick={() => setEditing(null)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}
          {store.products.length ? (
            <div className={styles.table}>
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Price</th>
                    <th>Stock</th>
                    <th>Status</th>
                    {!readOnly && <th>Manage</th>}
                  </tr>
                </thead>
                <tbody>
                  {store.products.map((product) => (
                    <tr key={product.id}>
                      <th
                        scope="row"
                        className={
                          product.parentId ? styles.variantCell : undefined
                        }
                      >
                        {product.photoAlt && (
                          <img
                            className={styles.productThumbnail}
                            src={photoUrl(product)}
                            alt={product.photoAlt}
                            loading="lazy"
                          />
                        )}
                        {product.name}
                        {product.sku && (
                          <p className={styles.sku}>{product.sku}</p>
                        )}
                      </th>
                      <td>
                        {parents.has(product.id)
                          ? 'By variant'
                          : money.format(product.price / 100)}
                      </td>
                      <td>
                        {parents.has(product.id) ? 'By variant' : product.stock}
                      </td>
                      <td>
                        <Pill tone={product.active ? 'good' : 'neutral'}>
                          {product.active ? 'Active' : 'Hidden'}
                        </Pill>
                      </td>
                      {!readOnly && (
                        <td>
                          <Button
                            variant="quiet"
                            disabled={busy}
                            onClick={() => setEditing({ product })}
                          >
                            Edit {product.name}
                          </Button>
                          {!product.parentId && (
                            <Button
                              variant="quiet"
                              disabled={busy}
                              aria-label={'Add variant to ' + product.name}
                              onClick={() => setEditing({ parent: product })}
                            >
                              Add variant
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>Your catalog is empty. Add a product to get started.</p>
          )}
        </>
      )}
      {section === 'Delivery' && (
        <StoreDeliverySettings
          key={store.deliveryRevision ?? 0}
          currency={store.currency}
          zones={store.zones ?? []}
          readOnly={readOnly}
          busy={busy}
          onSave={(zones) =>
            void save({
              action: 'delivery',
              revision: store.deliveryRevision ?? 0,
              zones,
            })
          }
        />
      )}
      {section === 'Report' && <StoreReport endpoint={endpoint} />}
      {section === 'Orders' && (
        <>
          <h3>Order requests</h3>
          <p>
            Confirming an order reserves stock.{' '}
            {store.paymentReady
              ? 'You can share a Stripe test payment link for confirmed orders.'
              : 'Arrange payment with the customer separately.'}
          </p>
          <StoreListFilters
            label="Search orders"
            filterLabel="Order status"
            query={orderSearch.q}
            filter={orderSearch.status}
            placeholder="Email, reference or product"
            options={storeOrderStatus.options.map((value) => ({
              value,
              label: value[0]!.toUpperCase() + value.slice(1),
            }))}
            onSearch={(q, status) => {
              setOrderSearch({
                ...(q ? { q } : {}),
                ...(status ? { status } : {}),
              });
              setOrderPages([{}]);
            }}
          />
          {orders.isPending && <p role="status">Loading orders…</p>}
          {orders.error && <p role="alert">{errorMessage(orders.error)}</p>}
          {orders.data?.orders.length ? (
            <div className={styles.table}>
              <table>
                <thead>
                  <tr>
                    <th>Items</th>
                    <th>Customer</th>
                    <th>Total</th>
                    <th>Status</th>
                    {!readOnly && <th>Manage</th>}
                  </tr>
                </thead>
                <tbody>
                  {orders.data.orders.map((order) => (
                    <tr key={order.id}>
                      <th scope="row">
                        {order.items
                          .map(
                            (item) => `${item.productName} × ${item.quantity}`,
                          )
                          .join(', ')}
                      </th>
                      <td>{order.email}</td>
                      <td>
                        {new Intl.NumberFormat(undefined, {
                          style: 'currency',
                          currency: order.currency,
                        }).format(
                          storeOrderTotal(order.items, order.delivery) / 100,
                        )}
                        {order.delivery && (
                          <details>
                            <summary>Delivery and tax</summary>
                            <p>{order.delivery.address.name}</p>
                            <p>
                              {[
                                order.delivery.address.street,
                                order.delivery.address.unit,
                                order.delivery.address.city,
                                order.delivery.address.region,
                                order.delivery.address.postalCode,
                                order.delivery.address.country,
                              ]
                                .filter(Boolean)
                                .join(', ')}
                            </p>
                            <p>
                              Shipping{' '}
                              {money.format(order.delivery.shipping / 100)}
                            </p>
                            <p>Tax {money.format(order.delivery.tax / 100)}</p>
                          </details>
                        )}
                      </td>
                      <td>
                        <span className={styles.status}>{order.status}</span>
                        {order.payment && <p>{paymentLabels[order.payment]}</p>}
                      </td>
                      {!readOnly && (
                        <td>
                          <div className={styles.actions}>
                            {order.status === 'requested' && (
                              <Button
                                disabled={busy}
                                variant="secondary"
                                onClick={() =>
                                  void save({
                                    action: 'order',
                                    id: order.id,
                                    status: 'confirmed',
                                  })
                                }
                              >
                                Confirm
                              </Button>
                            )}
                            {order.status === 'confirmed' &&
                              store.paymentReady &&
                              !order.saleId && (
                                <Button
                                  disabled={busy}
                                  variant="secondary"
                                  onClick={() =>
                                    void save({
                                      action: 'payment',
                                      id: order.id,
                                    })
                                  }
                                >
                                  Create test payment link
                                </Button>
                              )}
                            {order.status === 'confirmed' &&
                              order.payment === 'awaiting_payment' &&
                              order.saleId && (
                                <>
                                  <a
                                    href={'/sale/' + order.saleId}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    Open payment link ↗
                                  </a>
                                  <Button
                                    disabled={busy}
                                    variant="quiet"
                                    onClick={() =>
                                      void save({
                                        action: 'close_payment',
                                        id: order.id,
                                      })
                                    }
                                  >
                                    Close checkout
                                  </Button>
                                </>
                              )}
                            {order.status === 'confirmed' &&
                              (!order.saleId ||
                                order.payment === 'paid' ||
                                order.payment === 'partially_refunded') && (
                                <Button
                                  disabled={busy}
                                  variant="secondary"
                                  onClick={() =>
                                    void save({
                                      action: 'order',
                                      id: order.id,
                                      status: 'fulfilled',
                                    })
                                  }
                                >
                                  Fulfill
                                </Button>
                              )}
                            {['requested', 'confirmed'].includes(
                              order.status,
                            ) &&
                              (!order.saleId ||
                                order.payment === 'closed' ||
                                order.payment === 'refunded') && (
                                <Button
                                  disabled={busy}
                                  variant="quiet"
                                  onClick={() =>
                                    void save({
                                      action: 'order',
                                      id: order.id,
                                      status: 'cancelled',
                                    })
                                  }
                                >
                                  Cancel
                                </Button>
                              )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            orders.data && (
              <p>
                {Object.keys(orderSearch).length
                  ? 'No orders match this search.'
                  : 'Order requests from the published catalog appear here.'}
              </p>
            )
          )}
          <StoreListPagination
            page={orderPages.length}
            busy={orders.isFetching}
            next={Boolean(orders.data?.next)}
            onPrevious={() => setOrderPages(orderPages.slice(0, -1))}
            onNext={() => {
              if (orders.data?.next)
                setOrderPages([...orderPages, orders.data.next]);
            }}
          />
        </>
      )}
      {section === 'Customers' && (
        <>
          <h3>Customers</h3>
          <StoreListFilters
            label="Search customers"
            filterLabel="Account type"
            query={customerSearch.q}
            filter={customerSearch.kind}
            placeholder="Email address"
            options={[
              { value: 'verified', label: 'Verified' },
              { value: 'guest', label: 'Guest' },
            ]}
            onSearch={(q, kind) => {
              setCustomerSearch({
                ...(q ? { q } : {}),
                ...(kind ? { kind } : {}),
              });
              setCustomerPages([{}]);
            }}
          />
          {customers.isPending && <p role="status">Loading customers…</p>}
          {customers.error && (
            <p role="alert">{errorMessage(customers.error)}</p>
          )}
          {customers.data?.customers.length ? (
            <div className={styles.table}>
              <table>
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Orders</th>
                    <th>Account</th>
                    <th>Last request</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.data.customers.map((customer) => (
                    <tr key={customer.email}>
                      <th scope="row">{customer.email}</th>
                      <td>{customer.orderCount}</td>
                      <td>{customer.joinedAt ? 'Verified' : 'Guest'}</td>
                      <td>
                        {customer.lastOrderAt
                          ? new Date(customer.lastOrderAt).toLocaleDateString()
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            customers.data && (
              <p>
                {Object.keys(customerSearch).length
                  ? 'No customers match this search.'
                  : 'Verified accounts and guest buyers will appear here.'}
              </p>
            )
          )}
          <StoreListPagination
            page={customerPages.length}
            busy={customers.isFetching}
            next={Boolean(customers.data?.next)}
            onPrevious={() => setCustomerPages(customerPages.slice(0, -1))}
            onNext={() => {
              if (customers.data?.next)
                setCustomerPages([...customerPages, customers.data.next]);
            }}
          />
        </>
      )}
    </section>
  );
}
