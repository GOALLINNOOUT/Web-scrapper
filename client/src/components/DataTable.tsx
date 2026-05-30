import type { ReactNode } from 'react';

export interface DataColumn<T> {
  key: string;
  label: string;
  render?: (row: T) => ReactNode;
}

interface DataTableProps<T extends { _id?: string; id?: string; url?: string }> {
  columns: DataColumn<T>[];
  rows: T[];
  empty?: string;
}

export function DataTable<T extends { _id?: string; id?: string; url?: string }>({ columns, rows, empty = 'No data yet.' }: DataTableProps<T>) {
  return (
    <div className="overflow-auto rounded-lg border border-[#eaeae6] bg-white shadow-panel">
      <table className="w-full min-w-[720px] border-collapse">
        <thead>
          <tr>
            {columns.map((column) => <th className="border-b border-[#eaeae6] px-5 py-4 text-left text-sm font-bold text-muted" key={column.key}>{column.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-5 py-12 text-center text-muted">{empty}</td>
            </tr>
          ) : rows.map((row) => (
            <tr className="transition hover:bg-[#f5f5f2]" key={row._id || row.id || row.url}>
              {columns.map((column) => (
                <td className="max-w-[380px] border-b border-[#eaeae6] px-5 py-4 text-sm text-[#111110] [overflow-wrap:anywhere]" key={column.key}>{column.render ? column.render(row) : String(row[column.key as keyof T] ?? '')}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
