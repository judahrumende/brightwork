import type { FormEvent } from 'react';
import { Button } from '../ui/primitives';
import styles from './store-dashboard.module.css';

export function StoreListFilters({
  label,
  placeholder,
  filterLabel,
  options,
  query,
  filter,
  onSearch,
}: {
  label: string;
  placeholder?: string;
  filterLabel: string;
  query: string | undefined;
  filter: string | undefined;
  options: Array<{ value: string; label: string }>;
  onSearch: (search: string, filter: string) => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onSearch(
      String(data.get('q') ?? '').trim(),
      String(data.get('filter') ?? ''),
    );
  }
  return (
    <form className={styles.listFilters} onSubmit={submit}>
      <label>
        {label}
        <input
          name="q"
          type="search"
          placeholder={placeholder}
          maxLength={120}
          defaultValue={query}
        />
      </label>
      <label>
        {filterLabel}
        <select name="filter" defaultValue={filter}>
          <option value="">All</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" variant="secondary">
        Search
      </Button>
    </form>
  );
}

export function StoreListPagination({
  page,
  next,
  busy,
  onPrevious,
  onNext,
}: {
  page: number;
  next: boolean;
  busy: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <nav className={styles.actions} aria-label="Pagination">
      <Button
        type="button"
        variant="quiet"
        disabled={page <= 1 || busy}
        onClick={onPrevious}
      >
        Previous
      </Button>
      <span>Page {page}</span>
      <Button
        type="button"
        variant="quiet"
        disabled={!next || busy}
        onClick={onNext}
      >
        Next
      </Button>
    </nav>
  );
}
