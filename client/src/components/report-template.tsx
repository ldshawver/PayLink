import { useAuth } from "@/hooks/use-auth";
import { Printer, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface ReportMetaItem {
  label: string;
  value: string;
}

export interface ReportCompany {
  name: string;
  legalName?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  phone?: string | null;
  ein?: string | null;
}

// ── Utility: CSV export ────────────────────────────────────────────────────

export function exportReportCSV(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const escape = (v: string | number | null | undefined) => {
    const s = String(v ?? "");
    if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.map(escape).join(","), ...rows.map(r => r.map(escape).join(","))];
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── ReportShell ────────────────────────────────────────────────────────────
// Outer container that isolates the report for printing.
// The .report-print-container class is targeted by @media print in index.css.

interface ReportShellProps {
  children: React.ReactNode;
  onExportCSV?: () => void;
  csvLabel?: string;
  noDialog?: boolean;
  printTitle?: string;
}

export function ReportShell({ children, onExportCSV, csvLabel = "Export CSV", printTitle }: ReportShellProps) {
  const handlePrint = () => {
    // Grab the rendered report HTML
    const container = document.querySelector(".report-print-container") as HTMLElement | null;
    if (!container) { window.print(); return; }

    // Collect all stylesheets (Tailwind + custom CSS) from the current page
    const styles = [
      ...Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(l => l.outerHTML),
      ...Array.from(document.querySelectorAll("style")).map(s => s.outerHTML),
    ].join("\n");

    const title = printTitle || document.title;

    // Open a blank window — no dialog, no sidebar, no overflow constraints
    const win = window.open("", "_blank");
    if (!win) { window.print(); return; } // fallback if popup blocked

    win.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${title.replace(/</g, "&lt;")}</title>
  ${styles}
  <style>
    /* In the print window the container flows naturally — no dialog clipping */
    @media screen { body { padding: 1rem; background: white; } }
    @media print  { body { margin: 0; } }
    /* Suppress the visibility:hidden / position:absolute tricks from the main app print CSS */
    .report-print-container { position: static !important; visibility: visible !important; padding: 0.75in !important; }
    body { visibility: visible !important; position: static !important; }
  </style>
</head>
<body>
  ${container.outerHTML}
  <script>
    // Hide the Print/CSV toolbar buttons that were cloned with the HTML
    document.querySelectorAll('.report-no-print').forEach(function(el) { el.style.display = 'none'; });
    window.addEventListener('load', function() {
      setTimeout(function() { window.print(); }, 400);
    });
  </script>
</body>
</html>`);
    win.document.close();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2 justify-end report-no-print">
        {onExportCSV && (
          <Button variant="outline" size="sm" onClick={onExportCSV} data-testid="button-report-export-csv">
            <Download className="h-4 w-4 mr-1.5" />
            {csvLabel}
          </Button>
        )}
        <Button size="sm" onClick={handlePrint} data-testid="button-report-print">
          <Printer className="h-4 w-4 mr-1.5" />
          Print / Save PDF
        </Button>
      </div>

      <div className="report-print-container bg-white text-black rounded-md border border-slate-200 p-6 text-sm leading-relaxed overflow-x-auto">
        {children}
      </div>
    </div>
  );
}

// ── ReportHeader ───────────────────────────────────────────────────────────

interface ReportHeaderProps {
  title: string;
  subtitle?: string;
  company?: ReportCompany | null;
  metadata?: ReportMetaItem[];
}

export function ReportHeader({ title, subtitle, company, metadata }: ReportHeaderProps) {
  const cityStateZip = [company?.city, company?.state, company?.zip].filter(Boolean).join(", ");
  return (
    <div className="border-b border-slate-300 pb-4 mb-5">
      <div className="flex justify-between items-start gap-4">
        <div>
          <div className="text-2xl font-extrabold tracking-tight" style={{ color: "#0a7c7e" }}>
            PayLink
          </div>
          <div className="text-xs text-slate-500 mt-0.5">HR &amp; Payroll Platform</div>
        </div>
        {company && (
          <div className="text-right text-xs text-slate-600 space-y-0.5">
            <div className="font-semibold text-sm text-slate-800">{company.legalName || company.name}</div>
            {company.address && <div>{company.address}</div>}
            {cityStateZip && <div>{cityStateZip}</div>}
            {company.phone && <div>{company.phone}</div>}
            {company.ein && <div>EIN: {company.ein}</div>}
          </div>
        )}
      </div>

      <div className="mt-4">
        <h1 className="text-xl font-bold text-slate-900">{title}</h1>
        {subtitle && <p className="text-slate-500 text-xs mt-0.5">{subtitle}</p>}
      </div>

      {metadata && metadata.length > 0 && (
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1 text-xs">
          {metadata.map((item, i) => (
            <div key={i} className="flex gap-1">
              <span className="text-slate-500 shrink-0">{item.label}:</span>
              <span className="font-medium text-slate-800">{item.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── ReportSection ──────────────────────────────────────────────────────────

export function ReportSection({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      {title && (
        <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-2 pb-1 border-b border-slate-200">
          {title}
        </h2>
      )}
      {children}
    </div>
  );
}

// ── ReportTable ────────────────────────────────────────────────────────────

type CellValue = string | number | React.ReactNode;

interface ReportTableProps {
  headers: string[];
  rows: CellValue[][];
  footerRows?: CellValue[][];
  alignRight?: number[];
}

export function ReportTable({ headers, rows, footerRows, alignRight = [] }: ReportTableProps) {
  const align = (i: number) => alignRight.includes(i) ? "text-right" : "text-left";
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b-2 border-slate-300">
            {headers.map((h, i) => (
              <th key={i} className={`py-1.5 px-2 font-semibold text-slate-600 text-xs uppercase tracking-wide whitespace-nowrap ${align(i)}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={headers.length} className="py-4 text-center text-slate-400">No data</td>
            </tr>
          ) : (
            rows.map((row, ri) => (
              <tr key={ri} className={`border-b border-slate-100 ${ri % 2 === 1 ? "bg-slate-50" : ""}`}>
                {row.map((cell, ci) => (
                  <td key={ci} className={`py-1.5 px-2 text-slate-800 ${align(ci)}`}>{cell}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
        {footerRows && footerRows.length > 0 && (
          <tfoot>
            {footerRows.map((row, ri) => (
              <tr key={ri} className="border-t-2 border-slate-300 font-semibold bg-slate-50">
                {row.map((cell, ci) => (
                  <td key={ci} className={`py-1.5 px-2 text-slate-900 ${align(ci)}`}>{cell}</td>
                ))}
              </tr>
            ))}
          </tfoot>
        )}
      </table>
    </div>
  );
}

// ── ReportTotalsGrid ───────────────────────────────────────────────────────

interface TotalItem {
  label: string;
  value: string;
  emphasis?: boolean;
  negative?: boolean;
}

export function ReportTotalsGrid({ items, columns = 2 }: { items: TotalItem[]; columns?: 2 | 3 | 4 }) {
  const colClass: Record<number, string> = { 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4" };
  return (
    <div className={`grid ${colClass[columns]} gap-x-8 gap-y-1 text-xs`}>
      {items.map((item, i) => (
        <div
          key={i}
          className={`flex justify-between py-1 ${item.emphasis ? "border-t-2 border-slate-300 font-bold text-sm mt-1 pt-2" : "border-b border-slate-100"}`}
        >
          <span className="text-slate-500">{item.label}</span>
          <span className={item.negative ? "text-red-700" : item.emphasis ? "text-slate-900" : "font-medium text-slate-800"}>
            {item.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── ReportFooter ───────────────────────────────────────────────────────────

export function ReportFooter({ generatedBy, note }: { generatedBy?: string | null; note?: string }) {
  const now = new Date().toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  });
  return (
    <div className="mt-6 pt-3 border-t border-slate-200 text-xs text-slate-400 flex flex-col sm:flex-row justify-between gap-1">
      <span>
        Generated by PayLink{generatedBy ? ` · ${generatedBy}` : ""}
        {note ? ` · ${note}` : ""}
      </span>
      <span>{now}</span>
    </div>
  );
}

// ── useReportUser ──────────────────────────────────────────────────────────
// Convenience hook to get the current user's display name for report footers.

export function useReportUser(): string | null {
  const { user } = useAuth();
  return user?.username ?? null;
}
