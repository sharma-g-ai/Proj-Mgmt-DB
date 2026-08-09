"use client";

import type { ReactNode } from "react";
import { fmtMonthLabel } from "@/lib/format";
import {
  sheetGrandTotal,
  sheetMonthTotal,
  type InfraBillingToolBlock,
  type InfraBillingToolSheet,
} from "@/lib/report/infraBilling";

/**
 * InfraBilling pivot — same chrome as other report tabs (DataTable),
 * with a bordered grid and merged tool / External|Internal headers.
 */
export function InfraBillingMatrix({ sheets }: { sheets: InfraBillingToolSheet[] }) {
  if (sheets.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-gray-200 bg-white px-4 py-10 text-center text-sm text-gray-500">
        No infra invoices to report. Upload invoices on InfraSpecs with a billing tool set.
      </p>
    );
  }

  const sheet = sheets[0];
  return (
    <div className="space-y-2">
      {sheet.excludedFromUsdCount > 0 && (
        <p className="text-xs text-amber-800">
          {sheet.excludedFromUsdCount} invoice
          {sheet.excludedFromUsdCount === 1 ? "" : "s"} excluded from USD totals (missing
          amount, currency, or FX).
        </p>
      )}
      <div className="text-xs text-gray-500">
        {sheet.months.length} month{sheet.months.length === 1 ? "" : "s"} · amounts in USD
      </div>
      <CombinedSheet sheet={sheet} />
    </div>
  );
}

function blockColSpan(b: InfraBillingToolBlock): number {
  const projects = b.groups.reduce((n, g) => n + g.projects.length, 0);
  return projects + (b.showOwnershipHeaders ? b.groups.length : 0);
}

/** Shared cell chrome — matches DataTable + full grid borders. */
const bd = "border border-gray-200";
const head = `${bd} bg-gray-50 px-3 py-2 text-xs font-medium uppercase tracking-wide text-gray-500`;
const stickyHead = `sticky left-0 z-20 ${head}`;
const stickyBody = `sticky left-0 z-10 ${bd} bg-white px-3 py-2 text-xs font-medium text-gray-900`;
const body = `${bd} px-3 py-2 text-gray-700`;

function CombinedSheet({ sheet }: { sheet: InfraBillingToolSheet }) {
  const blocks = sheet.toolBlocks;
  const dataColSpan = blocks.reduce((n, b) => n + Math.max(blockColSpan(b), 1), 0) + 1;
  const anyOwnership = blocks.some((b) => b.showOwnershipHeaders);
  /** Tool + optional Billing row + project names. */
  const headerDepth = anyOwnership ? 3 : 2;

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      {/* border-separate keeps vertical borders visible with sticky Month column */}
      <table className="min-w-full border-separate border-spacing-0 text-sm">
        <thead>
          {/* Row 1 — Month (merged) · tools (merged) · Grand Total (merged) */}
          <tr>
            <th
              rowSpan={headerDepth}
              className={`${stickyHead} align-middle normal-case tracking-normal text-gray-700`}
            >
              Month
            </th>
            {blocks.map((b) => (
              <th
                key={b.tool}
                colSpan={Math.max(blockColSpan(b), 1)}
                className={`${head} text-center text-gray-700`}
              >
                {b.tool}
                <span className="ml-1 font-normal normal-case tracking-normal text-gray-400">
                  USD
                </span>
              </th>
            ))}
            <th
              rowSpan={headerDepth}
              className={`${head} align-middle text-center text-gray-700`}
            >
              Grand Total
            </th>
          </tr>

          {/* Row 2 — External | Internal (merged across project + total cols) */}
          {anyOwnership && (
            <tr>
              {blocks.map((b) => (
                <FragmentCols key={`own-${b.tool}`}>
                  {b.showOwnershipHeaders ? (
                    b.groups.map((g) => (
                      <th
                        key={`${b.tool}-${g.stakeholder}`}
                        colSpan={g.projects.length + 1}
                        className={`${head} text-center`}
                      >
                        {g.stakeholder}
                      </th>
                    ))
                  ) : (
                    <th
                      colSpan={Math.max(blockColSpan(b), 1)}
                      className={`${head} text-center normal-case tracking-normal text-gray-400`}
                    >
                      —
                    </th>
                  )}
                </FragmentCols>
              ))}
            </tr>
          )}

          {/* Row 3 — project names + External/Internal Total */}
          <tr>
            {blocks.map((b) => (
              <FragmentCols key={`proj-${b.tool}`}>
                {b.groups.map((g) => (
                  <FragmentCols key={`${b.tool}-${g.stakeholder}-cols`}>
                    {g.projects.map((p) => (
                      <th
                        key={`${b.tool}-${p.project_id}`}
                        className={`${head} text-center normal-case tracking-normal text-gray-700`}
                      >
                        {p.project_name}
                      </th>
                    ))}
                    {b.showOwnershipHeaders && (
                      <th className={`${head} text-center`}>{g.stakeholder} Total</th>
                    )}
                  </FragmentCols>
                ))}
              </FragmentCols>
            ))}
          </tr>
        </thead>
        <tbody>
          {sheet.months.length === 0 ? (
            <tr>
              <td colSpan={dataColSpan + 1} className={`${body} py-10 text-center text-gray-500`}>
                Invoices found but no billing months detected.
              </td>
            </tr>
          ) : (
            sheet.months.map((m) => (
              <tr key={m} className="hover:bg-gray-50">
                <td className={`${stickyBody} whitespace-nowrap`}>{fmtMonthLabel(m)}</td>
                {blocks.map((b) => (
                  <BlockMonthCells key={`${b.tool}-${m}`} block={b} month={m} />
                ))}
                <td className={`${body} text-right font-medium tabular-nums text-gray-900`}>
                  {fmtAmt(sheetMonthTotal(sheet, m))}
                </td>
              </tr>
            ))
          )}
          <tr className="bg-gray-50">
            <td
              className={`sticky left-0 z-10 whitespace-nowrap ${bd} bg-gray-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-600`}
            >
              Total
            </td>
            {blocks.map((b) => (
              <BlockTotalCells key={`total-${b.tool}`} block={b} />
            ))}
            <td className={`${bd} bg-gray-50 px-3 py-2 text-right font-semibold tabular-nums text-gray-900`}>
              {fmtAmt(sheetGrandTotal(sheet))}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function BlockMonthCells({ block, month }: { block: InfraBillingToolBlock; month: string }) {
  return (
    <FragmentCols>
      {block.groups.map((g) => (
        <FragmentCols key={`${block.tool}-${g.stakeholder}-${month}`}>
          {g.projects.map((p) => (
            <td
              key={`${block.tool}-${p.project_id}-${month}`}
              className={`${body} text-right tabular-nums`}
            >
              {fmtAmt(p.months[month])}
            </td>
          ))}
          {block.showOwnershipHeaders && (
            <td className={`${body} bg-gray-50/80 text-right font-medium tabular-nums text-gray-900`}>
              {fmtAmt(g.months[month])}
            </td>
          )}
        </FragmentCols>
      ))}
    </FragmentCols>
  );
}

function BlockTotalCells({ block }: { block: InfraBillingToolBlock }) {
  return (
    <FragmentCols>
      {block.groups.map((g) => (
        <FragmentCols key={`${block.tool}-${g.stakeholder}-tot`}>
          {g.projects.map((p) => (
            <td
              key={`${block.tool}-${p.project_id}-tot`}
              className={`${bd} bg-gray-50 px-3 py-2 text-right font-semibold tabular-nums text-gray-900`}
            >
              {fmtAmt(p.total)}
            </td>
          ))}
          {block.showOwnershipHeaders && (
            <td
              className={`${bd} bg-gray-50 px-3 py-2 text-right font-semibold tabular-nums text-gray-900`}
            >
              {fmtAmt(g.total)}
            </td>
          )}
        </FragmentCols>
      ))}
    </FragmentCols>
  );
}

function FragmentCols({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function fmtAmt(v: number | undefined): string {
  if (v == null || v === 0) return "—";
  return String(v);
}
