import { useQuery } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Printer, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import type { PayrollRun, PayrollItem, Worker, Company, TaxDeduction } from "@shared/schema";

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

function CheckStub({
  item,
  worker,
  company,
  run,
  deductions,
}: {
  item: PayrollItem;
  worker: Worker;
  company: Company;
  run: PayrollRun;
  deductions: TaxDeduction[];
}) {
  const netPay = Number(item.netPay || 0);
  const grossPay = Number(item.grossPay || 0);
  const totalDeductions = Number(item.deductions || 0);

  const deductionBreakdown = deductions
    .filter(d => d.isActive && !d.isEmployerPaid)
    .map(d => {
      let amount = 0;
      if (d.calculationType === "percentage") {
        amount = grossPay * (Number(d.rate || 0) / 100);
      } else {
        amount = Number(d.rate || 0);
      }
      return { name: d.name, amount };
    })
    .filter(d => d.amount > 0);

  return (
    <div className="check-page" style={{ width: "8.5in", height: "11in", pageBreakAfter: "always", fontFamily: "'Courier New', monospace" }}>
      <div style={{ height: "3.667in", borderBottom: "1px dashed #999", padding: "0.3in 0.5in", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: "14px", fontWeight: "bold" }}>{company.name}</div>
            {company.dba && <div style={{ fontSize: "11px" }}>DBA: {company.dba}</div>}
            {company.address && <div style={{ fontSize: "11px" }}>{company.address}</div>}
            {(company.city || company.state || company.zip) && (
              <div style={{ fontSize: "11px" }}>{[company.city, company.state].filter(Boolean).join(", ")} {company.zip}</div>
            )}
            {company.phone && <div style={{ fontSize: "11px" }}>{company.phone}</div>}
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "12px", fontWeight: "bold" }}>CHECK #{item.checkNumber || "—"}</div>
            <div style={{ fontSize: "11px" }}>Date: {run.processedAt ? new Date(run.processedAt).toLocaleDateString() : new Date().toLocaleDateString()}</div>
          </div>
        </div>

        <div style={{ margin: "0.15in 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
            <div style={{ fontSize: "12px" }}>
              <span style={{ fontWeight: "bold" }}>PAY TO THE ORDER OF: </span>
              {worker.firstName} {worker.lastName}
            </div>
            <div style={{ border: "1px solid #000", padding: "4px 12px", fontSize: "14px", fontWeight: "bold" }}>
              ${fmt(netPay)}
            </div>
          </div>
          <div style={{ borderBottom: "1px solid #000", paddingBottom: "4px", fontSize: "11px" }}>
            {numberToWords(netPay)} Dollars
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={{ fontSize: "11px" }}>
            {worker.address && <div>{worker.address}</div>}
            {(worker.city || worker.state || worker.zip) && (
              <div>{[worker.city, worker.state].filter(Boolean).join(", ")} {worker.zip}</div>
            )}
          </div>
          <div style={{ borderBottom: "1px solid #000", width: "3in", height: "0.4in" }}>
            <div style={{ fontSize: "9px", color: "#999" }}>Authorized Signature</div>
          </div>
        </div>
      </div>

      <div style={{ height: "7.333in", padding: "0.3in 0.4in", fontSize: "10px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
          <div>
            <div style={{ fontSize: "14px", fontWeight: "bold", marginBottom: "4px" }}>PAY STUB</div>
            <div style={{ fontSize: "11px", fontWeight: "bold" }}>{company.name}</div>
            {company.ein && <div>EIN: {company.ein}</div>}
          </div>
          <div style={{ textAlign: "right" }}>
            <div><strong>Employee:</strong> {worker.firstName} {worker.lastName}</div>
            <div><strong>Employee #:</strong> {worker.employeeNumber || "—"}</div>
            <div><strong>SSN:</strong> {worker.ssn ? "XXX-XX-" + worker.ssn.slice(-4) : "XXX-XX-XXXX"}</div>
            <div><strong>Department:</strong> {worker.department || "—"}</div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "2px solid #000", paddingBottom: "6px", marginBottom: "10px" }}>
          <div>
            <strong>Pay Period:</strong> {run.periodStart} to {run.periodEnd}
          </div>
          <div>
            <strong>Check #:</strong> {item.checkNumber || "—"}
          </div>
          <div>
            <strong>Pay Date:</strong> {run.processedAt ? new Date(run.processedAt).toLocaleDateString() : "—"}
          </div>
        </div>

        <div style={{ display: "flex", gap: "20px" }}>
          <div style={{ flex: 1 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #000" }}>
                  <th style={{ textAlign: "left", padding: "4px 2px", fontWeight: "bold" }}>EARNINGS</th>
                  <th style={{ textAlign: "right", padding: "4px 2px", fontWeight: "bold" }}>HOURS</th>
                  <th style={{ textAlign: "right", padding: "4px 2px", fontWeight: "bold" }}>RATE</th>
                  <th style={{ textAlign: "right", padding: "4px 2px", fontWeight: "bold" }}>CURRENT</th>
                  <th style={{ textAlign: "right", padding: "4px 2px", fontWeight: "bold" }}>YTD</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ padding: "3px 2px" }}>Regular</td>
                  <td style={{ textAlign: "right", padding: "3px 2px" }}>{fmt(item.regularHours)}</td>
                  <td style={{ textAlign: "right", padding: "3px 2px" }}>${fmt(item.payRate)}</td>
                  <td style={{ textAlign: "right", padding: "3px 2px" }}>${fmt(item.regularPay)}</td>
                  <td style={{ textAlign: "right", padding: "3px 2px" }}>${fmt(item.ytdGross)}</td>
                </tr>
                {Number(item.overtimeHours || 0) > 0 && (
                  <tr>
                    <td style={{ padding: "3px 2px" }}>Overtime</td>
                    <td style={{ textAlign: "right", padding: "3px 2px" }}>{fmt(item.overtimeHours)}</td>
                    <td style={{ textAlign: "right", padding: "3px 2px" }}>${fmt(Number(item.payRate || 0) * 1.5)}</td>
                    <td style={{ textAlign: "right", padding: "3px 2px" }}>${fmt(item.overtimePay)}</td>
                    <td style={{ textAlign: "right", padding: "3px 2px" }}>—</td>
                  </tr>
                )}
                <tr style={{ borderTop: "1px solid #000", fontWeight: "bold" }}>
                  <td style={{ padding: "3px 2px" }}>GROSS PAY</td>
                  <td style={{ textAlign: "right", padding: "3px 2px" }}>
                    {fmt(Number(item.regularHours || 0) + Number(item.overtimeHours || 0))}
                  </td>
                  <td style={{ padding: "3px 2px" }}></td>
                  <td style={{ textAlign: "right", padding: "3px 2px" }}>${fmt(item.grossPay)}</td>
                  <td style={{ textAlign: "right", padding: "3px 2px" }}>${fmt(item.ytdGross)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div style={{ flex: 1 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #000" }}>
                  <th style={{ textAlign: "left", padding: "4px 2px", fontWeight: "bold" }}>DEDUCTIONS</th>
                  <th style={{ textAlign: "right", padding: "4px 2px", fontWeight: "bold" }}>CURRENT</th>
                  <th style={{ textAlign: "right", padding: "4px 2px", fontWeight: "bold" }}>YTD</th>
                </tr>
              </thead>
              <tbody>
                {deductionBreakdown.map((d, i) => (
                  <tr key={i}>
                    <td style={{ padding: "3px 2px" }}>{d.name}</td>
                    <td style={{ textAlign: "right", padding: "3px 2px" }}>${fmt(d.amount)}</td>
                    <td style={{ textAlign: "right", padding: "3px 2px" }}>—</td>
                  </tr>
                ))}
                {deductionBreakdown.length === 0 && (
                  <tr>
                    <td style={{ padding: "3px 2px", color: "#999" }} colSpan={3}>No deductions</td>
                  </tr>
                )}
                <tr style={{ borderTop: "1px solid #000", fontWeight: "bold" }}>
                  <td style={{ padding: "3px 2px" }}>TOTAL DEDUCTIONS</td>
                  <td style={{ textAlign: "right", padding: "3px 2px" }}>${fmt(totalDeductions)}</td>
                  <td style={{ textAlign: "right", padding: "3px 2px" }}>${fmt(item.ytdDeductions)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ marginTop: "20px", borderTop: "2px solid #000", paddingTop: "10px" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div style={{ display: "flex", gap: "40px" }}>
              <div>
                <div style={{ fontSize: "9px", color: "#666" }}>GROSS PAY</div>
                <div style={{ fontSize: "14px", fontWeight: "bold" }}>${fmt(grossPay)}</div>
              </div>
              <div>
                <div style={{ fontSize: "9px", color: "#666" }}>DEDUCTIONS</div>
                <div style={{ fontSize: "14px", fontWeight: "bold" }}>${fmt(totalDeductions)}</div>
              </div>
              <div>
                <div style={{ fontSize: "9px", color: "#666" }}>NET PAY</div>
                <div style={{ fontSize: "14px", fontWeight: "bold" }}>${fmt(netPay)}</div>
              </div>
            </div>
            <div>
              <div style={{ display: "flex", gap: "30px" }}>
                <div>
                  <div style={{ fontSize: "9px", color: "#666" }}>YTD GROSS</div>
                  <div style={{ fontWeight: "bold" }}>${fmt(item.ytdGross)}</div>
                </div>
                <div>
                  <div style={{ fontSize: "9px", color: "#666" }}>YTD DEDUCTIONS</div>
                  <div style={{ fontWeight: "bold" }}>${fmt(item.ytdDeductions)}</div>
                </div>
                <div>
                  <div style={{ fontSize: "9px", color: "#666" }}>YTD NET</div>
                  <div style={{ fontWeight: "bold" }}>${fmt(item.ytdNet)}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ position: "relative", bottom: 0, marginTop: "20px", textAlign: "center", fontSize: "9px", color: "#999", borderTop: "1px solid #ccc", paddingTop: "6px" }}>
          This is a computer-generated document. {company.name} {company.ein ? `- EIN: ${company.ein}` : ""}
        </div>
      </div>
    </div>
  );
}

export default function PrintCheckPage() {
  const [, params] = useRoute("/print-check/:runId");
  const runId = params?.runId;

  const { data: run } = useQuery<PayrollRun>({
    queryKey: ["/api/payroll-runs", runId],
    queryFn: async () => {
      const res = await fetch(`/api/payroll-runs/${runId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: !!runId,
  });

  const { data: items = [] } = useQuery<PayrollItem[]>({
    queryKey: ["/api/payroll-runs", runId, "items"],
    queryFn: async () => {
      const res = await fetch(`/api/payroll-runs/${runId}/items`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch items");
      return res.json();
    },
    enabled: !!runId,
  });

  const { data: workers = [] } = useQuery<Worker[]>({ queryKey: ["/api/workers"] });
  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const { data: taxesDeductions = [] } = useQuery<TaxDeduction[]>({ queryKey: ["/api/taxes-deductions"] });

  if (!run || !runId) {
    return (
      <div className="p-6 text-center text-muted-foreground" data-testid="text-loading-checks">
        Loading check data...
      </div>
    );
  }

  if (run.status === "draft") {
    return (
      <div className="p-6 text-center space-y-4">
        <p className="text-muted-foreground" data-testid="text-not-processed">
          This payroll run has not been processed yet. Please process it first before printing checks.
        </p>
        <Link href="/payroll?tab=process">
          <Button variant="outline" data-testid="button-back-payroll">
            <ArrowLeft className="mr-2 h-4 w-4" />Back to Payroll
          </Button>
        </Link>
      </div>
    );
  }

  const company = companies.find(c => c.id === run.companyId);
  const companyDeductions = taxesDeductions.filter(d => d.companyId === run.companyId);

  const getWorker = (id: string) => workers.find(w => w.id === id);

  return (
    <div>
      <div className="p-4 flex items-center gap-3 print-hide flex-wrap" data-testid="div-print-controls">
        <Link href="/payroll?tab=process">
          <Button variant="outline" data-testid="button-back-payroll">
            <ArrowLeft className="mr-2 h-4 w-4" />Back to Payroll
          </Button>
        </Link>
        <Button onClick={() => window.print()} data-testid="button-print-checks">
          <Printer className="mr-2 h-4 w-4" />Print Checks
        </Button>
        <span className="text-sm text-muted-foreground">
          {items.length} check(s) for {company?.name || ""}
        </span>
      </div>

      <div className="print-content">
        {items.map((item) => {
          const worker = getWorker(item.workerId);
          if (!worker || !company) return null;
          return (
            <CheckStub
              key={item.id}
              item={item}
              worker={worker}
              company={company}
              run={run}
              deductions={companyDeductions}
            />
          );
        })}
      </div>

      <style>{`
        @media print {
          .print-hide { display: none !important; }
          body { margin: 0; padding: 0; }
          .check-page { page-break-after: always; }
          @page { size: 8.5in 11in; margin: 0; }
        }
        @media screen {
          .print-content {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 20px;
            padding: 20px;
            background: #f0f0f0;
          }
          .check-page {
            background: white;
            box-shadow: 0 2px 8px rgba(0,0,0,0.15);
          }
        }
      `}</style>
    </div>
  );
}
