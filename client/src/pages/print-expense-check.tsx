import { useQuery, useMutation } from "@tanstack/react-query";
import { useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Printer, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Company, Worker, Receipt } from "@shared/schema";

function numberToWords(num: number): string {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  if (num === 0) return "Zero";
  function convert(n: number): string {
    if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? "-" + ones[n % 10] : "");
    if (n < 1000) return ones[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " + convert(n % 100) : "");
    if (n < 1000000) return convert(Math.floor(n / 1000)) + " Thousand" + (n % 1000 ? " " + convert(n % 1000) : "");
    return convert(Math.floor(n / 1000000)) + " Million" + (n % 1000000 ? " " + convert(n % 1000000) : "");
  }
  const dollars = Math.floor(num);
  const cents = Math.round((num - dollars) * 100);
  return convert(dollars) + " and " + cents.toString().padStart(2, "0") + "/100";
}

function fmt(val: string | number | null | undefined): string {
  return Number(val || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const parts = d.split("-");
  return parts.length === 3 ? `${parts[1]}/${parts[2]}/${parts[0]}` : d;
}

function CompanyHeader({ company }: { company: Company }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
      {company.logoUrl && (
        <img src={company.logoUrl} alt="" style={{ height: "40px", width: "40px", objectFit: "contain" }} />
      )}
      <div>
        <div style={{ fontSize: "14px", fontWeight: "bold" }}>{company.name}</div>
        {company.dba && <div style={{ fontSize: "11px" }}>DBA: {company.dba}</div>}
        {company.address && <div style={{ fontSize: "11px" }}>{company.address}</div>}
        {(company.city || company.state || company.zip) && (
          <div style={{ fontSize: "11px" }}>{[company.city, company.state].filter(Boolean).join(", ")} {company.zip}</div>
        )}
        {company.phone && <div style={{ fontSize: "11px" }}>{company.phone}</div>}
      </div>
    </div>
  );
}

function ExpenseCheck({
  receipt, company, submitter, checkNumber, costCenters, jobs,
}: {
  receipt: Receipt; company: Company; submitter: Worker | undefined; checkNumber: number; costCenters: any[]; jobs: any[];
}) {
  const costCenterName = receipt.costCenterId ? (costCenters.find(c => c.id === receipt.costCenterId)?.name || receipt.costCenterId) : "—";
  const jobName = receipt.jobId ? (jobs.find(j => j.id === receipt.jobId)?.title || receipt.jobId) : "—";
  const amount = Number(receipt.amount || 0);
  const includeInJobCost = (receipt as any).includeInJobCost;
  const storedCheckNum = (receipt as any).checkNumber;

  return (
    <div className="check-page" style={{ width: "8.5in", height: "11in", pageBreakAfter: "always", fontFamily: "'Arial', 'Helvetica Neue', Helvetica, sans-serif" }}>

      {/* ── TOP THIRD: the check body ── */}
      <div style={{ height: "3.667in", padding: "0.25in 0.4in 0.15in", boxSizing: "border-box", position: "relative" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.25in" }}>
          <CompanyHeader company={company} />
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "11px", color: "#666", marginBottom: "2px" }}>CHECK NO.</div>
            <div style={{ fontSize: "14px", fontWeight: "bold", fontFamily: "monospace" }}>
              {storedCheckNum || String(checkNumber).padStart(6, "0")}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.18in" }}>
          <div style={{ fontSize: "10px", color: "#666" }}>Date</div>
          <div style={{ borderBottom: "1px solid #000", width: "2.5in", textAlign: "right", fontSize: "12px", paddingBottom: "2px" }}>
            {fmtDate(receipt.receiptDate)}
          </div>
        </div>

        <div style={{ marginBottom: "0.15in" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "8px", borderBottom: "1px solid #000", paddingBottom: "4px" }}>
            <span style={{ fontSize: "10px", color: "#666", whiteSpace: "nowrap" }}>PAY TO THE ORDER OF</span>
            <span style={{ fontSize: "14px", fontWeight: "500", flex: 1 }}>{receipt.vendor || "—"}</span>
            <div style={{ display: "flex", alignItems: "center", gap: "4px", border: "1px solid #000", padding: "2px 8px", minWidth: "1.5in" }}>
              <span style={{ fontSize: "11px", fontWeight: "bold" }}>$</span>
              <span style={{ fontSize: "14px", fontWeight: "bold", fontFamily: "monospace" }}>{fmt(amount)}</span>
            </div>
          </div>
        </div>

        <div style={{ marginBottom: "0.2in", borderBottom: "1px solid #000", paddingBottom: "4px" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
            <span style={{ fontSize: "14px", flex: 1 }}>{numberToWords(amount)} Dollars</span>
            <span style={{ fontSize: "9px", color: "#999", whiteSpace: "nowrap" }}>DOLLARS</span>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "0.2in" }}>
          <div>
            <div style={{ fontSize: "9px", color: "#666", marginBottom: "1px" }}>MEMO</div>
            <div style={{ borderBottom: "1px solid #000", minWidth: "2.5in", paddingBottom: "2px", fontSize: "11px" }}>
              {receipt.description || receipt.category || ""}
            </div>
          </div>
          <div style={{ borderBottom: "1px solid #000", width: "3.5in", height: "0.45in", display: "flex", alignItems: "flex-end", justifyContent: "flex-end" }}>
            <div style={{ fontSize: "9px", color: "#999", paddingBottom: "2px" }}>Authorized Signature</div>
          </div>
        </div>

        <div style={{ borderTop: "2px solid #000", paddingTop: "4px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontFamily: "'MICR Encoding', 'Courier New', monospace", fontSize: "13px", letterSpacing: "2px", color: "#222" }}>
            ⑆{company.ein ? company.ein.replace(/\D/g, "") : "000000000"}⑆ ⑈{storedCheckNum || String(checkNumber).padStart(6, "0")}⑈
          </div>
        </div>
      </div>

      {/* ── MIDDLE THIRD: submitter / accounting stub ── */}
      <div style={{ height: "3.667in", borderTop: "1px dashed #999", padding: "0.15in 0.4in 0.15in", boxSizing: "border-box", fontSize: "10px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "2px solid #000", paddingBottom: "5px", marginBottom: "8px" }}>
          <div>
            <div style={{ fontWeight: "bold", fontSize: "12px", marginBottom: "2px" }}>EXPENSE CHECK — REMITTANCE COPY</div>
            <div style={{ color: "#555" }}>{company.name}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontWeight: "bold", fontSize: "11px" }}>Check No. {storedCheckNum || String(checkNumber).padStart(6, "0")}</div>
            <div>Date: {fmtDate(receipt.receiptDate)}</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: "24px" }}>
          <div style={{ flex: 1 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "10px" }}>
              <tbody>
                <tr><td style={{ padding: "2px 4px", color: "#555" }}>Pay To (Vendor):</td><td style={{ padding: "2px 4px", fontWeight: "bold" }}>{receipt.vendor || "—"}</td></tr>
                <tr><td style={{ padding: "2px 4px", color: "#555" }}>Amount:</td><td style={{ padding: "2px 4px", fontWeight: "bold" }}>${fmt(amount)}</td></tr>
                <tr><td style={{ padding: "2px 4px", color: "#555" }}>Category:</td><td style={{ padding: "2px 4px", textTransform: "capitalize" }}>{receipt.category?.replace(/-/g, " ") || "general"}</td></tr>
                <tr><td style={{ padding: "2px 4px", color: "#555" }}>Description:</td><td style={{ padding: "2px 4px" }}>{receipt.description || "—"}</td></tr>
                {receipt.notes && <tr><td style={{ padding: "2px 4px", color: "#555" }}>Notes:</td><td style={{ padding: "2px 4px" }}>{receipt.notes}</td></tr>}
              </tbody>
            </table>
          </div>
          <div style={{ flex: 1 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "10px" }}>
              <tbody>
                <tr><td style={{ padding: "2px 4px", color: "#555" }}>Submitted By:</td><td style={{ padding: "2px 4px" }}>{submitter ? `${submitter.firstName} ${submitter.lastName}` : "—"}</td></tr>
                <tr><td style={{ padding: "2px 4px", color: "#555" }}>Cost Center:</td><td style={{ padding: "2px 4px" }}>{costCenterName}</td></tr>
                <tr><td style={{ padding: "2px 4px", color: "#555" }}>Job:</td><td style={{ padding: "2px 4px" }}>{jobName}</td></tr>
                <tr>
                  <td style={{ padding: "2px 4px", color: "#555" }}>Include in Job Cost:</td>
                  <td style={{ padding: "2px 4px", fontWeight: "bold", color: includeInJobCost ? "#16a34a" : "#555" }}>
                    {includeInJobCost ? "YES" : "No"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div style={{ marginTop: "12px", borderTop: "1px solid #ccc", paddingTop: "8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: "9px", color: "#999" }}>Computer-generated expense check — {company.name}{company.ein ? ` — EIN: ${company.ein}` : ""}</div>
          <div style={{ fontWeight: "bold", fontSize: "12px" }}>TOTAL: ${fmt(amount)}</div>
        </div>
      </div>

      {/* ── BOTTOM THIRD: employee / vendor copy ── */}
      <div style={{ height: "3.666in", borderTop: "1px dashed #999", padding: "0.15in 0.4in 0.15in", boxSizing: "border-box", fontSize: "10px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "2px solid #000", paddingBottom: "5px", marginBottom: "8px" }}>
          <div>
            <div style={{ fontWeight: "bold", fontSize: "12px", marginBottom: "2px" }}>EXPENSE CHECK — VENDOR COPY</div>
            <div style={{ color: "#555" }}>{company.name}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontWeight: "bold", fontSize: "11px" }}>Check No. {storedCheckNum || String(checkNumber).padStart(6, "0")}</div>
            <div>Date: {fmtDate(receipt.receiptDate)}</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: "24px" }}>
          <div style={{ flex: 2 }}>
            <div style={{ marginBottom: "8px" }}>
              <div style={{ fontWeight: "bold", fontSize: "11px", marginBottom: "3px" }}>Payment to:</div>
              <div style={{ fontSize: "12px" }}>{receipt.vendor || "—"}</div>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #000" }}>
                  <th style={{ textAlign: "left", padding: "3px 4px" }}>Description</th>
                  <th style={{ textAlign: "left", padding: "3px 4px" }}>Category</th>
                  <th style={{ textAlign: "right", padding: "3px 4px" }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ padding: "3px 4px" }}>{receipt.description || "Expense"}</td>
                  <td style={{ padding: "3px 4px", textTransform: "capitalize" }}>{receipt.category?.replace(/-/g, " ") || "general"}</td>
                  <td style={{ textAlign: "right", padding: "3px 4px" }}>${fmt(amount)}</td>
                </tr>
                <tr style={{ borderTop: "2px solid #000", fontWeight: "bold" }}>
                  <td colSpan={2} style={{ padding: "3px 4px" }}>TOTAL DUE</td>
                  <td style={{ textAlign: "right", padding: "3px 4px" }}>${fmt(amount)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div style={{ flex: 1, borderLeft: "1px solid #ccc", paddingLeft: "16px" }}>
            {includeInJobCost && (
              <div style={{ background: "#f0fdf4", border: "1px solid #16a34a", borderRadius: "4px", padding: "6px 8px", marginBottom: "8px" }}>
                <div style={{ fontWeight: "bold", fontSize: "9px", color: "#16a34a", marginBottom: "2px" }}>ALLOCATED TO JOB COST</div>
                {receipt.jobId && <div style={{ fontSize: "9px" }}>Job: {jobName}</div>}
                {receipt.costCenterId && <div style={{ fontSize: "9px" }}>Cost Center: {costCenterName}</div>}
              </div>
            )}
            <div style={{ fontSize: "9px", color: "#666" }}>Authorized by: ___________________</div>
            <div style={{ fontSize: "9px", color: "#666", marginTop: "6px" }}>Date: ___________________</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PrintExpenseCheckPage() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const idsParam = params.get("ids") || "";
  const receiptIds = idsParam.split(",").filter(Boolean);

  const { data: receipts = [], isLoading: loadingReceipts } = useQuery<Receipt[]>({
    queryKey: ["/api/receipts"],
  });

  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: workers = [] } = useQuery<Worker[]>({ queryKey: ["/api/workers"] });
  const { data: costCenters = [] } = useQuery<any[]>({ queryKey: ["/api/cost-centers"] });
  const { data: jobs = [] } = useQuery<any[]>({ queryKey: ["/api/jobs"] });

  const selectedReceipts = receipts.filter(r => receiptIds.includes(r.id));

  const saveCheckNumberMutation = useMutation({
    mutationFn: async ({ id, checkNumber }: { id: string; checkNumber: string }) => {
      await apiRequest("PATCH", `/api/receipts/${id}`, { checkNumber });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/receipts"] });
    },
  });

  function handlePrint() {
    selectedReceipts.forEach((r, i) => {
      if (!(r as any).checkNumber) {
        const num = String(Date.now()).slice(-6);
        saveCheckNumberMutation.mutate({ id: r.id, checkNumber: num });
      }
    });
    window.print();
  }

  if (loadingReceipts) {
    return (
      <div className="p-6 text-center text-muted-foreground" data-testid="text-loading-expense-checks">
        Loading expense data...
      </div>
    );
  }

  if (selectedReceipts.length === 0) {
    return (
      <div className="p-6 text-center space-y-4">
        <p className="text-muted-foreground" data-testid="text-no-expense-checks">No expense receipts found for the provided IDs.</p>
        <Link href="/expenses">
          <Button variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />Back to Expenses
          </Button>
        </Link>
      </div>
    );
  }

  const baseCheckNumber = parseInt(String(Date.now()).slice(-6));

  return (
    <div>
      <div className="p-4 flex items-center gap-3 print-hide flex-wrap" data-testid="div-print-controls">
        <Link href="/expenses">
          <Button variant="outline" data-testid="button-back-expenses">
            <ArrowLeft className="mr-2 h-4 w-4" />Back to Expenses
          </Button>
        </Link>
        <Button onClick={handlePrint} data-testid="button-print-expense-checks">
          <Printer className="mr-2 h-4 w-4" />Print Checks
        </Button>
        <span className="text-sm text-muted-foreground" data-testid="text-expense-check-info">
          {selectedReceipts.length} check{selectedReceipts.length !== 1 ? "s" : ""} ready to print
        </span>
      </div>

      <div className="print-content">
        {selectedReceipts.map((receipt, i) => {
          const company = companies.find(c => c.id === receipt.companyId);
          const submitter = workers.find(w => w.id === receipt.workerId);
          if (!company) {
            return (
              <div key={receipt.id} className="p-4 text-muted-foreground print-hide">
                Receipt {receipt.vendor} — no company assigned (cannot print check without a company)
              </div>
            );
          }
          return (
            <ExpenseCheck
              key={receipt.id}
              receipt={receipt}
              company={company}
              submitter={submitter}
              checkNumber={baseCheckNumber + i}
              costCenters={costCenters}
              jobs={jobs}
            />
          );
        })}
      </div>

      <style>{`
        @media print {
          .print-hide { display: none !important; }
          body { margin: 0; padding: 0; }
          .check-page { page-break-after: always; }
        }
      `}</style>
    </div>
  );
}
