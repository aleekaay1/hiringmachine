import React from 'react';

export function ReportDataTable({
  columns,
  rows,
  emptyMessage = 'No rows in this period.',
}: {
  columns: Array<{ key: string; label: string; className?: string }>;
  rows: Array<Record<string, string | number | boolean>>;
  emptyMessage?: string;
}) {
  if (rows.length === 0) {
    return <p className="px-3 py-4 text-sm text-[#5c7594]">{emptyMessage}</p>;
  }

  return (
    <div className="overflow-x-auto max-h-[min(52vh,520px)]">
      <table className="w-full min-w-[720px] border-collapse text-left text-xs">
        <thead className="sticky top-0 z-10 border-b border-[#d9e5f6] bg-[#f4f9ff]">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={`whitespace-nowrap px-3 py-2 font-semibold uppercase tracking-wide text-[#6d86a3] ${col.className || ''}`}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={String(row.id ?? idx)} className="border-b border-[#eef4fb] hover:bg-white/80">
              {columns.map((col) => (
                <td key={col.key} className={`px-3 py-2 text-[#35567a] ${col.className || ''}`}>
                  {String(row[col.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
