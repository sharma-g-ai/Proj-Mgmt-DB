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

// A single sortable + filterable table. Manages its own sort/filter/column-visibility
// state and lifts the resolved (filtered + sorted) rows and the visible column keys to
// the parent (onResolved / onVisibleColumnsChange) so an export can reproduce exactly
// what's on screen. When `groupBy` is supplied and no sort is active, consecutive rows
// sharing a group key are banded together and `group` columns show only on each group's
// first row.
export function DataTable<T>({
  rows,
  columns,
  initialFilters,
  onResolved,
  onVisibleColumnsChange,
  groupBy,
  emptyMessage = "No rows match.",
}: {
  rows: T[];
  columns: ColumnDef<T>[];
  initialFilters?: Record<string, string>;
  onResolved?: (rows: T[]) => void;
  onVisibleColumnsChange?: (keys: string[]) => void;
  groupBy?: (row: T) => string;
  emptyMessage?: string;
}) {
  const [sort, setSort] = useState<SortState>(null);
  const [filters, setFilters] = useState<Record<string, string>>(initialFilters ?? {});
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);

  const visibleColumns = useMemo(
    () => columns.filter((c) => !hidden.has(c.key)),
    [columns, hidden]
  );

  useEffect(() => {
    onVisibleColumnsChange?.(visibleColumns.map((c) => c.key));
  }, [visibleColumns, onVisibleColumnsChange]);

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
    // Only visible columns' filters apply (hiding a column drops its filter).
    for (const col of visibleColumns) {
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
  }, [rows, columns, visibleColumns, filters, sort]);

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

  function toggleColumn(key: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        // keep at least one column visible
        if (columns.length - next.size <= 1) return prev;
        next.add(key);
      }
      return next;
    });
  }

  const stickyHead = "sticky left-0 z-20 bg-gray-50";
  const stickyCell = "sticky left-0 z-10 bg-white";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-gray-500">
          {resolved.length} of {rows.length} row{rows.length === 1 ? "" : "s"}
          {hidden.size > 0 && ` · ${hidden.size} column${hidden.size === 1 ? "" : "s"} hidden`}
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={() => setPickerOpen((o) => !o)}
            className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Columns ▾
          </button>
          {pickerOpen && (
            <>
              {/* click-away backdrop */}
              <div className="fixed inset-0 z-30" onClick={() => setPickerOpen(false)} />
              <div className="absolute right-0 z-40 mt-1 max-h-72 w-56 overflow-auto rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
                {columns.map((col) => {
                  const visible = !hidden.has(col.key);
                  const isLast = visible && columns.length - hidden.size <= 1;
                  return (
                    <label
                      key={col.key}
                      className="flex items-center gap-2 rounded px-2 py-1 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      <input
                        type="checkbox"
                        checked={visible}
                        disabled={isLast}
                        onChange={() => toggleColumn(col.key)}
                      />
                      <span className="truncate">{col.label}</span>
                    </label>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr className="border-b border-gray-200">
              {visibleColumns.map((col, i) => {
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
              {visibleColumns.map((col, i) => (
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
                <td colSpan={visibleColumns.length} className="px-3 py-10 text-center text-gray-500">
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
                {visibleColumns.map((col, ci) => {
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
