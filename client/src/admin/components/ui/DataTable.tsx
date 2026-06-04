import { useMemo, useState } from 'react';

export function DataTable<T extends Record<string, unknown>>({ columns, data, onRowClick, defaultSortKey, pageSize = 10 }: {
  columns: Array<{ key: keyof T & string; label: string; render?: (row: T) => React.ReactNode }>;
  data: T[];
  onRowClick?: (row: T) => void;
  defaultSortKey?: keyof T & string;
  pageSize?: number;
}) {
  const [sortKey, setSortKey] = useState(defaultSortKey || columns[0]?.key);
  const [page, setPage] = useState(0);
  const sorted = useMemo(() => [...data].sort((a, b) => String(b[sortKey] ?? '').localeCompare(String(a[sortKey] ?? ''), undefined, { numeric: true })), [data, sortKey]);
  const pageData = sorted.slice(page * pageSize, page * pageSize + pageSize);
  return (
    <div>
      <table className="admin-table">
        <thead><tr>{columns.map((column) => <th key={column.key}><button type="button" onClick={() => setSortKey(column.key)}>{column.label}</button></th>)}</tr></thead>
        <tbody>
          {pageData.map((row, index) => <tr key={String(row.id || row._id || index)} onClick={() => onRowClick?.(row)} className={onRowClick ? 'cursor-pointer' : ''}>{columns.map((column) => <td key={column.key}>{column.render ? column.render(row) : String(row[column.key] ?? '')}</td>)}</tr>)}
        </tbody>
      </table>
      <div className="mt-3 flex justify-end gap-2">
        <button className="admin-btn" type="button" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>Prev</button>
        <button className="admin-btn" type="button" disabled={(page + 1) * pageSize >= sorted.length} onClick={() => setPage((value) => value + 1)}>Next</button>
      </div>
    </div>
  );
}
