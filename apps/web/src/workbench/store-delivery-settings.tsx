import { useState } from 'react';
import type { FormEvent } from 'react';
import { storeDeliveryZones } from '@brightwork/shared';
import type { StoreDeliveryZone } from '@brightwork/shared';
import { Button } from '../ui/primitives';
import styles from './store-dashboard.module.css';

const blank = {
  country: '',
  shipping: 0,
  freeAbove: null,
  taxRate: 0,
  taxShipping: false,
};

export function StoreDeliverySettings({
  currency,
  zones,
  readOnly,
  busy,
  onSave,
}: {
  currency: string;
  zones: StoreDeliveryZone[];
  readOnly: boolean;
  busy: boolean;
  onSave: (zones: StoreDeliveryZone[]) => void;
}) {
  const [rows, setRows] = useState(() =>
    zones.map((zone, id) => ({ id, ...zone })),
  );
  const [next, setNext] = useState(zones.length);
  const [error, setError] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const parsed = storeDeliveryZones.safeParse(
      rows.map(({ id }) => {
        const read = (name: string) => String(fields.get(name + id) ?? '');
        return {
          country: read('country'),
          shipping: Math.round(Number(read('shipping')) * 100),
          freeAbove: read('free')
            ? Math.round(Number(read('free')) * 100)
            : null,
          taxRate: Math.round(Number(read('tax')) * 100),
          taxShipping: fields.has('taxShipping' + id),
        };
      }),
    );
    if (!parsed.success) {
      setError(
        'Check the country codes and amounts. Use one rule per country.',
      );
      return;
    }
    setError('');
    onSave(parsed.data);
  }
  return (
    <>
      <h3>Shipping and tax</h3>
      <p>
        Add a destination to collect addresses and show a delivery total at
        checkout. Tax is added to item prices. Enter the rates you have
        configured for your store.
      </p>
      {error && <p role="alert">{error}</p>}
      <form className={styles.form} onSubmit={submit}>
        {!rows.length && (
          <p>
            No destinations configured. Shoppers can submit a basic order
            request.
          </p>
        )}
        {rows.map((row) => (
          <fieldset
            key={row.id}
            className={styles.form}
            disabled={busy || readOnly}
          >
            <legend>{row.country || 'New destination'}</legend>
            <label>
              Two-letter country code
              <input
                name={'country' + row.id}
                defaultValue={row.country}
                minLength={2}
                maxLength={2}
                placeholder="AU"
                required
              />
            </label>
            <label>
              Flat shipping fee ({currency})
              <input
                name={'shipping' + row.id}
                type="number"
                defaultValue={row.shipping / 100}
                min="0"
                max="1000000"
                step=".01"
                required
              />
            </label>
            <label>
              Free shipping from ({currency}, optional)
              <input
                name={'free' + row.id}
                type="number"
                defaultValue={row.freeAbove === null ? '' : row.freeAbove / 100}
                min=".01"
                max="1000000"
                step=".01"
              />
            </label>
            <label>
              Tax rate (%)
              <input
                name={'tax' + row.id}
                type="number"
                defaultValue={row.taxRate / 100}
                min="0"
                max="100"
                step=".01"
                required
              />
            </label>
            <label>
              <input
                name={'taxShipping' + row.id}
                type="checkbox"
                defaultChecked={row.taxShipping}
              />{' '}
              Apply tax to shipping
            </label>
            {!readOnly && (
              <Button
                type="button"
                variant="quiet"
                onClick={() => setRows(rows.filter(({ id }) => id !== row.id))}
              >
                Remove destination
              </Button>
            )}
          </fieldset>
        ))}
        {!readOnly && (
          <div className={styles.toolbar}>
            <Button
              type="button"
              variant="secondary"
              disabled={busy || rows.length >= 50}
              onClick={() => {
                setRows([...rows, { id: next, ...blank }]);
                setNext(next + 1);
              }}
            >
              Add destination
            </Button>
            <Button type="submit" disabled={busy}>
              Save shipping and tax
            </Button>
          </div>
        )}
      </form>
    </>
  );
}
