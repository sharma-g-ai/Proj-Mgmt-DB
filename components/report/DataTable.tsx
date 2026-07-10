"use client";

import { useEffect, useMemo, useState } from "react";

// Excel-like column definition. `sortValue` drives ordering (numeric compare for
// numbers, ISO/string compare otherwise so DD/MM/YYYY display doesn't break dates);
// `display` is what the cell shows; `filterText` is the string used for both the
// substring text filter and to enumerate distinct values for a select filter.
// `group: true` marks a column whose value is collapsed to the first row of each
// group when grouping is active (see `groupBy`).
export type ColumnDef<T> = {
  key: string;
  label: string;
  align?: "left" | "right";
  filter: "text" | "select";
  group?: boolean;
  sortValue: (row: T) => string | number;
  display: (row: T) => React.ReactNode;
  filterText: (row: T) => string;
};

type SortState = { key: string; dir: "asc" | "desc" } | null;

// A single sortable + filterable table. Manages its own sort/filter state and
// lifts the resolved (filtered + sorted) rows to the parent via onResolved so an
// export can serialize exactly what's on screen. When `groupBy` is supplied and no
// sort is active, consecutive rows sharing a group key are banded together and the
// `group` columns are shown only on each group's first row.
export function DataTable<T>({
  rows,
  columns,
  initialFilters,
  onResolved,
  groupBy,
  emptyMessage = "No rows match.",
}: {
  rows: T[];
  columns: ColumnDef<T>[];
  initialFilters?: Record<string, string>;
  onResolved?: (rows: T[]) => void;
  groupBy?: (row: T) => string;
  emptyMessage?: string;
}) {
  const [sort, setSort] = useState<SortState>(null);
  const [filters, setFilters] = useState<Record<string, string>>(initialFilters ?? {});

  // Distinct values for select-filter columns.
  const distinct = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const col of columns) {
      if (col.filter !== "select") continue;
      const set = new Set<string>();
      for (const r of rows) set.add(col.filterText(r));
      map[col.key] = Array.from(set).sort((a, b) => a.localeCompare(b));
    }
    return map;
  }, [rows, columns]);

  const resolved = useMemo(() => {
    let out = rows;
    for (const col of columns) {
      const f = filters[col.key];
      if (!f) continue;
      if (col.filter === "text") {
        const needle = f.toLowerCase();
        out = out.filter((r) => col.filterText(r).toLowerCase().includes(needle));
      } else {
        out = out.filter((r) => col.filterText(r) === f);
      }
    }
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col) {
        const dir = sort.dir === "asc" ? 1 : -1;
        out = [...out].sort((a, b) => {
          const av = col.sortValue(a);
          const bv = col.sortValue(b);
          if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
          return String(av).localeCompare(String(bv)) * dir;
        });
      }
    }
    return out;
  }, [rows, columns, filters, sort]);

  useEffect(() => {
    onResolved?.(resolved);
  }, [resolved, onResolved]);

  // Grouping only makes sense while rows keep their natural (grouped) order.
  const grouping = !!groupBy && sort === null;
  const rendered = useMemo(() => {
    if (!grouping || !groupBy) return resolved.map((row) => ({ row, groupStart: false }));
    let prev: string | null = null;
    return resolved.map((row) => {
      const key = groupBy(row);
      const groupStart = key !== prev;
      prev = key;
      return { row, groupStart };
    });
  }, [resolved, grouping, groupBy]);

  // asc → desc → unsorted
  function toggleSort(key: string) {
    setSort((prev) => {
      if (prev?.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  }

  function setFilter(key: string, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  const stickyHead = "sticky left-0 z-20 bg-gray-50";
  const stickyCell = "sticky left-0 z-10 bg-white";

  return (
    <div className="space-y-2">
      <div className="text-xs text-gray-500">
        {resolved.length} of {rows.length} row{rows.length === 1 ? "" : "s"}
      </div>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr className="border-b border-gray-200">
              {columns.map((col, i) => {
                const active = sort?.key === col.key;
                return (
                  <th
                    key={col.key}
                    className={`px-3 py-2 align-bottom font-medium ${col.align === "right" ? "text-right" : ""} ${
                      i === 0 ? `${stickyHead} border-r border-gray-200` : ""
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      className={`inline-flex items-start gap-1 hover:text-gray-800 ${
                        col.align === "right" ? "flex-row-reverse" : ""
                      }`}
                    >
                      <span className="whitespace-normal">{col.label}</span>
                      <span aria-hidden className="mt-0.5 text-[10px]">
                        {active ? (sort!.dir === "asc" ? "▲" : "▼") : "↕"}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
            <tr className="border-b border-gray-200">
              {columns.map((col, i) => (
                <th
                  key={col.key}
                  className={`px-3 pb-2 font-normal ${i === 0 ? `${stickyHead} border-r border-gray-200` : ""}`}
                >
                  {col.filter === "select" ? (
                    <select
                      value={filters[col.key] ?? ""}
                      onChange={(e) => setFilter(col.key, e.target.value)}
                      className="w-full rounded border border-gray-300 bg-white px-1.5 py-1 text-xs font-normal text-gray-700"
                    >
                      <option value="">All</option>
                      {(distinct[col.key] ?? []).map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={filters[col.key] ?? ""}
                      onChange={(e) => setFilter(col.key, e.target.value)}
                      placeholder="Filter…"
                      className="w-full min-w-[5rem] rounded border border-gray-300 bg-white px-1.5 py-1 text-xs font-normal text-gray-700"
                    />
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className={grouping ? "" : "divide-y divide-gray-100"}>
            {rendered.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-10 text-center text-gray-500">
                  {emptyMessage}
                </td>
              </tr>
            )}
            {rendered.map(({ row, groupStart }, i) => (
              <tr
                key={i}
                className={`hover:bg-gray-50 ${
                  grouping && groupStart && i > 0 ? "border-t border-gray-200" : ""
                }`}
              >
                {columns.map((col, ci) => {
                  const hide = grouping && col.group && !groupStart;
                  const isText = col.filter === "text" && col.align !== "right";
                  return (
                    <td
                      key={col.key}
                      className={`whitespace-nowrap px-3 py-2 text-gray-700 ${
                        col.align === "right" ? "text-right tabular-nums" : ""
                      } ${ci === 0 ? `${stickyCell} border-r border-gray-100 font-medium text-gray-900` : ""}`}
                    >
                      {hide ? null : isText ? (
                        <span className="block max-w-[15rem] truncate" title={col.filterText(row)}>
                          {col.display(row)}
                        </span>
                      ) : (
                        col.display(row)
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
