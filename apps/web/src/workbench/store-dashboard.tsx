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
  StoreActivity,
  StoreDiscount,
  StoreEmailLog,
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
  discounts: StoreDiscount[];
  counts: { openRequests: number; awaitingFulfillment: number };
  paymentReady?: boolean;
  paymentMode: 'test' | 'live';
  paymentModes: Array<'test' | 'live'>;
  directCheckout?: boolean;
  zones?: StoreDeliveryZone[];
  deliveryRevision?: number;
};
const sections = [
  'Overview',
  'Products',
  'Orders',
  'Emails',
  'Activity',
  'Discounts',
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

function parseRefundAmount(value: string) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/u.exec(value.trim());
  if (!match) return null;
  const amount =
    Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
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
  const [emailPages, setEmailPages] = useState<Record<string, string>[]>([{}]);
  const [activityPages, setActivityPages] = useState<Record<string, string>[]>([
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
  const emailParams = new URLSearchParams(emailPages.at(-1)).toString();
  const activityParams = new URLSearchParams(activityPages.at(-1)).toString();
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
  const emails = useQuery({
    queryKey: ['store-data', endpoint, 'emails', emailParams],
    queryFn: ({ signal }) =>
      api<{
        emails: StoreEmailLog[];
        next: Record<string, string> | null;
      }>(endpoint + '/emails?' + emailParams, { signal }),
    enabled: section === 'Emails',
  });
  const activity = useQuery({
    queryKey: ['store-data', endpoint, 'activity', activityParams],
    queryFn: ({ signal }) =>
      api<{ activity: StoreActivity[]; next: Record<string, string> | null }>(
        endpoint + '/activity?' + activityParams,
        { signal },
      ),
    enabled: section === 'Activity',
  });
  const [editing, setEditing] = useState<ProductEdit | null>(null);
  const [editingDiscount, setEditingDiscount] = useState<
    StoreDiscount | 'new' | null
  >(null);
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
      setEditingDiscount(null);
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
  async function fulfillOrder(id: string) {
    const number = window.prompt(
      'Tracking number (leave blank to fulfill without tracking):',
    );
    if (number === null) return;
    let tracking: { carrier: string; number: string; url: string } | undefined;
    if (number.trim()) {
      const carrier = window.prompt('Carrier name:');
      if (carrier === null) return;
      const url = window.prompt('HTTPS tracking link:');
      if (url === null) return;
      try {
        const parsed = new URL(url.trim());
        if (
          !carrier.trim() ||
          parsed.protocol !== 'https:' ||
          parsed.username ||
          parsed.password
        )
          throw new Error('invalid tracking details');
      } catch {
        setError('Enter a carrier and a valid HTTPS tracking link.');
        return;
      }
      tracking = {
        carrier: carrier.trim(),
        number: number.trim(),
        url: url.trim(),
      };
    }
    await save({
      action: 'order',
      id,
      status: 'fulfilled',
      ...(tracking ? { tracking } : {}),
    });
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
  async function saveDiscount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || editingDiscount === null) return;
    const data = new FormData(event.currentTarget);
    const maxUsesValue = String(data.get('maxUses') ?? '').trim();
    const expiryValue = String(data.get('expiresAt') ?? '').trim();
    const discount = {
      code: String(data.get('code') ?? ''),
      percentOff: Number(data.get('percentOff')),
      active: data.has('active'),
      maxUses: maxUsesValue ? Number(maxUsesValue) : null,
      expiresAt: expiryValue ? new Date(expiryValue).toISOString() : null,
      ...(editingDiscount !== 'new'
        ? { revision: editingDiscount.revision }
        : {}),
    };
    await save({ action: 'discount', discount });
  }
  function localDateTime(value: string | null) {
    if (!value) return '';
    const date = new Date(value);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 16);
  }
  function emailEventLabel(event: string) {
    if (event.startsWith('tracking:')) return 'Tracking updated';
    if (event === 'order_received') return 'Order received';
    if (event === 'fulfilled') return 'Order fulfilled';
    if (event === 'cancelled') return 'Order cancelled';
    return 'Store update';
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
        <div className={styles.sectionTabs}>
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
        </div>
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
            <h3>Stripe checkout</h3>
            <label>
              Payment mode{' '}
              <select
                value={store.paymentMode}
                disabled={busy || readOnly}
                onChange={(event) =>
                  event.target.value === 'live' &&
                  !window.confirm(
                    'Live mode uses your separate live Stripe seller and can charge real payments. Continue?',
                  )
                    ? undefined
                    : void save({
                        action: 'payment_mode',
                        mode: event.target.value,
                      })
                }
              >
                {store.paymentModes.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode === 'test' ? 'Test' : 'Live'}
                  </option>
                ))}
              </select>
            </label>
            <p>
              {store.directCheckout && store.paymentReady
                ? 'Shoppers can pay directly from the catalog in ' +
                  store.paymentMode +
                  ' mode.'
                : 'Shoppers can submit an order request for you to review.'}
            </p>
            {!readOnly && (store.paymentReady || store.directCheckout) && (
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  !store.directCheckout &&
                  store.paymentMode === 'live' &&
                  !window.confirm(
                    'Enable live checkout? Shoppers will be charged real payments through your live Stripe seller.',
                  )
                    ? undefined
                    : void save({
                        action: 'checkout',
                        enabled: !store.directCheckout,
                      })
                }
              >
                {store.directCheckout
                  ? 'Turn off direct checkout'
                  : 'Enable direct checkout'}
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
      {section === 'Emails' && (
        <>
          <h3>Customer emails</h3>
          <p>
            Order and fulfillment updates are queued for the email worker.
            Provider acceptance does not confirm delivery.
          </p>
          {emails.isPending && <p role="status">Loading customer emails…</p>}
          {emails.error && <p role="alert">{errorMessage(emails.error)}</p>}
          {emails.data?.emails.length ? (
            <div className={styles.table}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">Recipient</th>
                    <th scope="col">Event</th>
                    <th scope="col">Status</th>
                    <th scope="col">Attempts</th>
                    <th scope="col">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {emails.data.emails.map((email) => (
                    <tr key={email.id}>
                      <th scope="row">{email.recipient}</th>
                      <td>{emailEventLabel(email.event)}</td>
                      <td>
                        <strong>{email.status.replace('_', ' ')}</strong>
                        {email.note && <p>{email.note}</p>}
                      </td>
                      <td>{email.attempts}</td>
                      <td>{new Date(email.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            emails.data && <p>No customer emails have been queued.</p>
          )}
          <StoreListPagination
            page={emailPages.length}
            busy={emails.isFetching}
            next={Boolean(emails.data?.next)}
            onPrevious={() => setEmailPages(emailPages.slice(0, -1))}
            onNext={() => {
              if (emails.data?.next)
                setEmailPages([...emailPages, emails.data.next]);
            }}
          />
        </>
      )}
      {section === 'Activity' && (
        <>
          <h3>Store activity</h3>
          <p>Recent customer orders and changes made by your team.</p>
          {activity.isPending && <p role="status">Loading store activity…</p>}
          {activity.error && <p role="alert">{errorMessage(activity.error)}</p>}
          {activity.data?.activity.length ? (
            <div className={styles.table}>
              <table>
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>By</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {activity.data.activity.map((event) => (
                    <tr key={event.id}>
                      <td>{event.summary}</td>
                      <td>
                        {event.actor ??
                          (event.kind === 'order.requested'
                            ? 'Customer'
                            : event.kind.startsWith('payment.')
                              ? 'Stripe'
                              : 'System')}
                      </td>
                      <td>
                        <time dateTime={event.createdAt}>
                          {new Date(event.createdAt).toLocaleString()}
                        </time>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            !activity.isPending &&
            !activity.error && <p>No store activity yet.</p>
          )}
          <StoreListPagination
            page={activityPages.length}
            busy={activity.isFetching}
            next={Boolean(activity.data?.next)}
            onPrevious={() => setActivityPages(activityPages.slice(0, -1))}
            onNext={() => {
              if (activity.data?.next)
                setActivityPages([...activityPages, activity.data.next]);
            }}
          />
        </>
      )}
      {section === 'Discounts' && (
        <>
          <h3>Discount codes</h3>
          <p>
            Percentage discounts apply to the product subtotal before shipping
            and tax. A code is counted when an order is submitted.
          </p>
          {!readOnly && editingDiscount === null && (
            <Button
              variant="secondary"
              onClick={() => setEditingDiscount('new')}
            >
              Add discount code
            </Button>
          )}
          {!readOnly && editingDiscount !== null && (
            <form className={styles.form} onSubmit={saveDiscount}>
              <label>
                Code
                <input
                  name="code"
                  required
                  minLength={3}
                  maxLength={32}
                  pattern="[A-Za-z0-9][A-Za-z0-9-]{1,30}[A-Za-z0-9]"
                  defaultValue={
                    editingDiscount === 'new' ? '' : editingDiscount.code
                  }
                  readOnly={editingDiscount !== 'new'}
                />
              </label>
              <label>
                Percent off
                <input
                  name="percentOff"
                  type="number"
                  required
                  min={1}
                  max={90}
                  defaultValue={
                    editingDiscount === 'new' ? 10 : editingDiscount.percentOff
                  }
                />
              </label>
              <label>
                Maximum redemptions (optional)
                <input
                  name="maxUses"
                  type="number"
                  min={1}
                  defaultValue={
                    editingDiscount === 'new'
                      ? ''
                      : (editingDiscount.maxUses ?? '')
                  }
                />
              </label>
              <label>
                Expires at (optional)
                <input
                  name="expiresAt"
                  type="datetime-local"
                  defaultValue={
                    editingDiscount === 'new'
                      ? ''
                      : localDateTime(editingDiscount.expiresAt)
                  }
                />
              </label>
              <label>
                <input
                  name="active"
                  type="checkbox"
                  defaultChecked={
                    editingDiscount === 'new' || editingDiscount.active
                  }
                />
                Active
              </label>
              <div className={styles.actions}>
                <Button type="submit" disabled={busy}>
                  Save discount
                </Button>
                <Button
                  type="button"
                  variant="quiet"
                  onClick={() => setEditingDiscount(null)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}
          {store.discounts.length ? (
            <div className={styles.table}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">Code</th>
                    <th scope="col">Offer</th>
                    <th scope="col">Uses</th>
                    <th scope="col">Status</th>
                    {!readOnly && <th scope="col">Manage</th>}
                  </tr>
                </thead>
                <tbody>
                  {store.discounts.map((discount) => (
                    <tr key={discount.code}>
                      <th scope="row">{discount.code}</th>
                      <td>{discount.percentOff}% off</td>
                      <td>
                        {discount.usedCount}
                        {discount.maxUses === null
                          ? ''
                          : ` / ${discount.maxUses}`}
                      </td>
                      <td>{discount.active ? 'Active' : 'Inactive'}</td>
                      {!readOnly && (
                        <td>
                          <Button
                            variant="quiet"
                            onClick={() => setEditingDiscount(discount)}
                          >
                            Edit {discount.code}
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>No discount codes yet.</p>
          )}
        </>
      )}
      {section === 'Report' && (
        <StoreReport endpoint={endpoint} mode={store.paymentMode} />
      )}
      {section === 'Orders' && (
        <>
          <h3>Order requests</h3>
          <p>
            Confirming an order reserves stock.{' '}
            {store.paymentReady
              ? 'You can share a Stripe ' +
                store.paymentMode +
                ' payment link for confirmed orders.'
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
                  {orders.data.orders.map((order) => {
                    const orderMoney = new Intl.NumberFormat(undefined, {
                      style: 'currency',
                      currency: order.currency,
                    });
                    const total = storeOrderTotal(
                      order.items,
                      order.delivery,
                      order.discount?.amount ?? 0,
                    );
                    return (
                      <tr key={order.id}>
                        <th scope="row">
                          {order.items
                            .map(
                              (item) =>
                                `${item.productName} × ${item.quantity}`,
                            )
                            .join(', ')}
                        </th>
                        <td>{order.email}</td>
                        <td>
                          {orderMoney.format(total / 100)}
                          {order.amountRefunded > 0 && (
                            <p>
                              Refunded{' '}
                              {orderMoney.format(order.amountRefunded / 100)} ·
                              Net paid{' '}
                              {orderMoney.format(
                                Math.max(0, total - order.amountRefunded) / 100,
                              )}
                            </p>
                          )}
                          {order.discount && (
                            <p>
                              Discount {order.discount.code} · −
                              {orderMoney.format(order.discount.amount / 100)}
                            </p>
                          )}
                          {order.tracking && (
                            <p>
                              <a
                                href={order.tracking.url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {order.tracking.carrier} ·{' '}
                                {order.tracking.number}
                              </a>
                            </p>
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
                              <p>
                                Tax {money.format(order.delivery.tax / 100)}
                              </p>
                            </details>
                          )}
                        </td>
                        <td>
                          <span className={styles.status}>{order.status}</span>
                          {order.payment && (
                            <p>
                              {paymentLabels[order.payment]} ·{' '}
                              {order.paymentMode === 'live' ? 'Live' : 'Test'}
                            </p>
                          )}
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
                                    {'Create ' +
                                      store.paymentMode +
                                      ' payment link'}
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
                              {['confirmed', 'fulfilled'].includes(
                                order.status,
                              ) &&
                                ['paid', 'partially_refunded'].includes(
                                  order.payment ?? '',
                                ) && (
                                  <Button
                                    disabled={busy}
                                    variant="quiet"
                                    onClick={() => {
                                      const remaining =
                                        storeOrderTotal(
                                          order.items,
                                          order.delivery,
                                          order.discount?.amount ?? 0,
                                        ) - order.amountRefunded;
                                      const input = window.prompt(
                                        `Amount to refund (up to ${money.format(remaining / 100)}):`,
                                        (remaining / 100).toFixed(2),
                                      );
                                      if (input === null) return;
                                      const amount = parseRefundAmount(input);
                                      if (!amount || amount > remaining) {
                                        setError(
                                          'Enter a refund amount in dollars up to the remaining paid amount.',
                                        );
                                        return;
                                      }
                                      if (
                                        window.confirm(
                                          `Refund ${money.format(amount / 100)}? This action cannot be undone.`,
                                        )
                                      )
                                        void save({
                                          action: 'refund',
                                          id: order.id,
                                          amount,
                                          requestId: crypto.randomUUID(),
                                        });
                                    }}
                                  >
                                    Refund payment
                                  </Button>
                                )}
                              {!readOnly &&
                                ['confirmed', 'fulfilled'].includes(
                                  order.status,
                                ) &&
                                (!order.saleId ||
                                  order.payment === 'paid' ||
                                  order.payment === 'partially_refunded') && (
                                  <Button
                                    disabled={busy}
                                    variant="secondary"
                                    onClick={() => void fulfillOrder(order.id)}
                                  >
                                    {order.status === 'fulfilled'
                                      ? order.tracking
                                        ? 'Update tracking'
                                        : 'Add tracking'
                                      : 'Fulfill'}
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
                    );
                  })}
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
