import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import type { Page } from '../../types/domain';

interface Option {
  id: string;
  name: string;
}
export function SearchableSelect({
  id,
  value,
  onChange,
  loadPage,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (id: string) => void;
  loadPage: (page: number) => Promise<Page<Option>>;
  placeholder: string;
}) {
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState<Option[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadPage(page)
      .then((result) => {
        if (!cancelled) {
          setOptions((current) =>
            page === 1
              ? result.items
              : [
                  ...current,
                  ...result.items.filter((item) => !current.some((old) => old.id === item.id)),
                ],
          );
          setTotal(result.total);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadPage, page]);
  const filtered = useMemo(
    () => options.filter((option) => option.name.toLowerCase().includes(search.toLowerCase())),
    [options, search],
  );
  return (
    <div className="space-y-2">
      <Input
        aria-label={`${placeholder} search`}
        placeholder={`Search ${placeholder.toLowerCase()}`}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <Select
        id={id}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        onInput={(event) => onChange(event.currentTarget.value)}
      >
        <option value="">{placeholder}</option>
        {filtered.map((option) => (
          <option value={option.id} key={option.id}>
            {option.name}
          </option>
        ))}
      </Select>
      {options.length < total ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          loading={loading}
          onClick={() => setPage((current) => current + 1)}
        >
          Load more
        </Button>
      ) : null}
    </div>
  );
}
