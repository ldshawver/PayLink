import { useQuery } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Printer, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import type { PayrollRun, PayrollItem, Worker, Company, TaxDeduction, CheckTemplate, PayStubAccount, AccrualAccount, AccrualBalance, PayStubAmendment, RemittanceSource } from "@shared/schema";

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

const DEFAULT_CONFIG = {
  showCompanyLogo: true,
  showCompanyName: true,
  showCompanyAddress: true,
  showCheckNumber: true,
  showMicrLine: true,
  showEarningsDetail: true,
  showDeductionsDetail: true,
  showYtdTotals: true,
  showPayPeriod: true,
  showEmployeeAddress: true,
};

function CompanyHeader({ company, config }: { company: Company; config: Record<string, boolean> }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
      {config.showCompanyLogo && company.logoUrl && (
        <img src={company.logoUrl} alt="" style={{ height: "40px", width: "40px", objectFit: "contain" }} />
      )}
      <div>
        {config.showCompanyName && <div style={{ fontSize: "14px", fontWeight: "bold" }}>{company.name}</div>}
        {company.dba && config.showCompanyName && <div style={{ fontSize: "11px" }}>DBA: {company.dba}</div>}
        {config.showCompanyAddress && company.address && <div style={{ fontSize: "11px" }}>{company.address}</div>}
        {config.showCompanyAddress && (company.city || company.state || company.zip) && (
          <div style={{ fontSize: "11px" }}>{[company.city, company.state].filter(Boolean).join(", ")} {company.zip}</div>
        )}
        {config.showCompanyAddress && company.phone && <div style={{ fontSize: "11px" }}>{company.phone}</div>}
      </div>
    </div>
  );
}

function CheckPortion({
  item, worker, company, run, config, overrideNetPay, remittanceSources = [],
}: {
  item: PayrollItem; worker: Worker; company: Company; run: PayrollRun; config: Record<string, boolean>; overrideNetPay?: number; remittanceSources?: RemittanceSource[];
}) {
  const remittanceSource = remittanceSources.find(s => s.companyId === company.id && s.status === "enabled") || remittanceSources.find(s => s.companyId === company.id);
  const netPay = overrideNetPay !== undefined ? overrideNetPay : Number(item.netPay || 0);
  const checkDate = run.processedAt ? new Date(run.processedAt).toLocaleDateString() : new Date().toLocaleDateString();
  const memoText = (run.periodStart && run.periodEnd)
    ? `Payroll ${new Date(run.periodStart + "T00:00:00").toLocaleDateString()} to ${new Date(run.periodEnd + "T00:00:00").toLocaleDateString()}`
    : "";

  return (
    <div style={{ height: "3.667in", boxSizing: "border-box", padding: "0.3in 0.6in 0.25in", display: "flex", flexDirection: "column" }}>
      {/* Company header + check number / date / void notice */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.15in" }}>
        <CompanyHeader company={company} config={config} />
        <div style={{ textAlign: "right" }}>
          {config.showCheckNumber && <div style={{ fontSize: "14px", fontWeight: "bold" }}>CHECK #{item.checkNumber || "—"}</div>}
          <div style={{ fontSize: "12px", marginTop: "4px" }}>Date: {checkDate}</div>
          <div style={{ fontSize: "9px", color: "#666", marginTop: "2px", fontStyle: "italic" }}>Void after 90 days</div>
        </div>
      </div>

      {/* Pay-to / amount */}
      <div style={{ marginBottom: "0.1in" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
          <div style={{ fontSize: "13px" }}>
            <span style={{ fontWeight: "bold" }}>PAY TO THE ORDER OF: </span>
            <span style={{ fontSize: "15px" }}>{worker.firstName} {worker.lastName}</span>
          </div>
          <div style={{ border: "2px solid #000", padding: "6px 16px", fontSize: "18px", fontWeight: "bold", minWidth: "1.5in", textAlign: "right" }}>
            ${fmt(netPay)}
          </div>
        </div>
        <div style={{ borderBottom: "1px solid #000", paddingBottom: "6px", fontSize: "12px" }}>
          {numberToWords(netPay)} Dollars
        </div>
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Memo (bottom-left) + signature line (bottom-right) */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "0.45in" }}>
        {/* Left: memo line */}
        <div>
          <div style={{ fontSize: "9px", color: "#666", marginBottom: "1px" }}>MEMO</div>
          <div style={{ borderBottom: "1px solid #000", minWidth: "2.5in", paddingBottom: "2px", fontSize: "11px" }}>
            {memoText}
          </div>
        </div>
        {/* Right: signature line */}
        <div style={{ textAlign: "right" }}>
          <div style={{ borderBottom: "1px solid #000", width: "3.5in", height: "0.45in", display: "flex", alignItems: "flex-end", justifyContent: "flex-end" }}>
            <div style={{ fontSize: "9px", color: "#999", paddingBottom: "2px" }}>Authorized Signature</div>
          </div>
        </div>
      </div>

      {/* MICR band — last flex item, sits at the bottom */}
      {config.showMicrLine && (
        <div style={{ textAlign: "center" }}>
          <span style={{ fontSize: "12pt", fontWeight: "normal", fontFamily: "'MICR', 'Courier New', monospace", letterSpacing: "1px", color: "#000" }}>
            ⑈{remittanceSource?.routingNumber || "000000000"}⑈ ⑆{remittanceSource?.accountNumber || company.ein || "000000000"}⑆ {String(item.checkNumber || "0000").padStart(4, "0")}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Middle third for StandardCheck: mailing stub ──
// Left column: company return address (top) + employee mailing address (center window zone)
// Right column: all pay stub data — clear of address areas
function StubSummarySection({
  item, worker, company, run, config, deductions = [], accrualAccounts = [], accrualBalances = [],
}: {
  item: PayrollItem; worker: Worker; company: Company; run: PayrollRun; config: Record<string, boolean>; deductions?: TaxDeduction[]; accrualAccounts?: AccrualAccount[]; accrualBalances?: AccrualBalance[];
}) {
  const netPay = Number(item.netPay || 0);
  const grossPay = Number(item.grossPay || 0);
  const totalDeductions = Number(item.deductions || 0);
  const regularHours = Number(item.regularHours || 0);
  const overtimeHours = Number(item.overtimeHours || 0);
  const doubleTimeHours = Number(item.doubleTimeHours || 0);
  const totalHours = regularHours + overtimeHours + doubleTimeHours;
  const isContractor = worker.workerType === "contractor";
  const ytdGross = Number(item.ytdGross || 0);

  const SS_WAGE_BASE = 168600;
  const ssTaxCurrent = isContractor ? Math.min(grossPay, SS_WAGE_BASE) * 0.124 : 0;
  const medicareTaxCurrent = isContractor ? grossPay * 0.029 : 0;
  const totalSeTaxCurrent = ssTaxCurrent + medicareTaxCurrent;
  const ssTaxYtd = isContractor ? Math.min(ytdGross, SS_WAGE_BASE) * 0.124 : 0;
  const medicareTaxYtd = isContractor ? ytdGross * 0.029 : 0;
  const totalSeTaxYtd = ssTaxYtd + medicareTaxYtd;

  const workerAccrualBalances = accrualBalances.filter(b => b.workerId === worker.id);
  const sickAccounts = accrualAccounts.filter(a => a.type === "sick" && a.isActive);
  const workerLeaveBalances = workerAccrualBalances
    .map(b => {
      const account = accrualAccounts.find(a => a.id === b.accrualAccountId);
      if (!account || !account.isActive) return null;
      return { name: account.name, type: account.type, balance: Number(b.balance || 0), used: Number(b.usedHours || 0) };
    })
    .filter((b): b is NonNullable<typeof b> => b !== null);

  const deductionBreakdown = deductions
    .filter(d => d.isActive && !d.isEmployerPaid && !d.isReferenceOnly)
    .filter(d => {
      const appliesTo = d.appliesTo || "all";
      if (appliesTo === "contractor") return false;
      return !isContractor;
    })
    .map(d => {
      let amount = 0;
      if (d.calculationType === "percentage") {
        const base = d.maxAmount ? Math.min(grossPay, Number(d.maxAmount)) : grossPay;
        amount = base * (Number(d.rate || 0) / 100);
      } else {
        amount = Number(d.rate || 0);
      }
      return { name: d.name, amount };
    })
    .filter(d => d.amount > 0);

  return (
    <div style={{ height: "3.667in", boxSizing: "border-box", display: "flex", flexDirection: "column" }}>

      {/* ══ ENVELOPE WINDOWS + PAYSTUB LAYOUT ══
           Company address top-left | Employee address (0.5" indent) below
           Paystub starts at 4.3" and extends right (larger fonts) */}
      <div style={{
        flex: 1,
        boxSizing: "border-box",
        position: "relative",
        display: "flex",
        flexDirection: "row",
        padding: "0.1in 0.35in",
      }}>
        {/* LEFT SECTION: Addresses positioned for #10 double-window envelope */}
        <div style={{ position: "absolute", left: "0.35in", top: "0", width: "3.95in", height: "100%" }}>
          {/* TOP WINDOW: Company return address — 12mm from top of section, 9mm from left */}
          <div style={{ position: "absolute", top: "12mm", left: "9mm", fontSize: "9px" }}>
            <div style={{ fontWeight: "bold", fontSize: "10px", marginBottom: "2px" }}>{company.name}</div>
            {company.address && <div style={{ fontSize: "8px", lineHeight: "1.1" }}>{company.address}</div>}
            {(company.city || company.state || company.zip) && (
              <div style={{ fontSize: "8px" }}>{[company.city, company.state].filter(Boolean).join(", ")} {company.zip}</div>
            )}
          </div>

          {/* BOTTOM WINDOW: Employee mailing address — 55mm from top, 15mm from left */}
          <div style={{ position: "absolute", top: "55mm", left: "15mm", fontSize: "10px" }}>
            <div style={{ fontWeight: "bold", fontSize: "11px", marginBottom: "3px" }}>{worker.firstName} {worker.lastName}</div>
            {worker.address && <div style={{ fontSize: "9px", lineHeight: "1.1" }}>{worker.address}</div>}
            {(worker.city || worker.state || worker.zip) && (
              <div style={{ fontSize: "9px" }}>{[worker.city, worker.state].filter(Boolean).join(", ")} {worker.zip}</div>
            )}
          </div>
        </div>

        {/* RIGHT: PAYSTUB DETAIL — starts at 4.3", larger fonts */}
        <div style={{ marginLeft: "4.3in", flex: 1, fontSize: "8px", display: "flex", flexDirection: "column", justifyContent: "flex-start", paddingRight: "0.2in" }}>
          {/* Header: company name, EIN, pay period */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "2px" }}>
            <div>
              <div style={{ fontWeight: "bold", fontSize: "10px" }}>PAYSTUB</div>
              <div style={{ fontSize: "7px", color: "#333" }}>{company.name}{company.ein ? ` — EIN: ${company.ein}` : ""}</div>
            </div>
            <div style={{ textAlign: "right", fontSize: "6px" }}>
              {config.showPayPeriod && <div>Pay Period: {run.periodStart.slice(0, 10)} – {run.periodEnd.slice(0, 10)}</div>}
              {run.processedAt && <div>Pay Date: {new Date(run.processedAt).toLocaleDateString()}</div>}
            </div>
          </div>
          {isContractor && (
            <div style={{ fontSize: "6px", color: "#666", marginBottom: "2px", fontStyle: "italic", borderBottom: "1px solid #ddd", paddingBottom: "1px" }}>
              Independent contractor — responsible for self-employment tax (15.3% SE tax: 12.4% SS + 2.9% Medicare)
            </div>
          )}

          {/* Earnings table */}
          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "2px", fontSize: "8px" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #000" }}>
                <th style={{ textAlign: "left", padding: "2px 3px", fontSize: "7px", fontWeight: "bold" }}>EARNINGS</th>
                <th style={{ textAlign: "right", padding: "2px 3px", fontSize: "7px", fontWeight: "bold" }}>HOURS</th>
                <th style={{ textAlign: "right", padding: "2px 3px", fontSize: "7px", fontWeight: "bold" }}>RATE</th>
                <th style={{ textAlign: "right", padding: "2px 3px", fontSize: "7px", fontWeight: "bold" }}>CURRENT</th>
                <th style={{ textAlign: "right", padding: "2px 3px", fontSize: "7px", fontWeight: "bold" }}>YTD</th>
              </tr>
            </thead>
            <tbody>
              {regularHours > 0 && (
                <tr>
                  <td style={{ padding: "1px 3px", textAlign: "left" }}>Regular</td>
                  <td style={{ padding: "1px 3px", textAlign: "right" }}>{fmt(regularHours)}</td>
                  <td style={{ padding: "1px 3px", textAlign: "right" }}>—</td>
                  <td style={{ padding: "1px 3px", textAlign: "right" }}>—</td>
                  <td style={{ padding: "1px 3px", textAlign: "right" }}>—</td>
                </tr>
              )}
              {overtimeHours > 0 && (
                <tr>
                  <td style={{ padding: "1px 3px", textAlign: "left" }}>Overtime</td>
                  <td style={{ padding: "1px 3px", textAlign: "right" }}>{fmt(overtimeHours)}</td>
                  <td style={{ padding: "1px 3px", textAlign: "right" }}>—</td>
                  <td style={{ padding: "1px 3px", textAlign: "right" }}>—</td>
                  <td style={{ padding: "1px 3px", textAlign: "right" }}>—</td>
                </tr>
              )}
              {doubleTimeHours > 0 && (
                <tr>
                  <td style={{ padding: "1px 3px", textAlign: "left" }}>Double Time</td>
                  <td style={{ padding: "1px 3px", textAlign: "right" }}>{fmt(doubleTimeHours)}</td>
                  <td style={{ padding: "1px 3px", textAlign: "right" }}>—</td>
                  <td style={{ padding: "1px 3px", textAlign: "right" }}>—</td>
                  <td style={{ padding: "1px 3px", textAlign: "right" }}>—</td>
                </tr>
              )}
              <tr style={{ fontWeight: "bold", borderTop: "1px solid #999" }}>
                <td style={{ padding: "1px 3px", textAlign: "left" }}>TOTAL HOURS</td>
                <td style={{ padding: "1px 2px", textAlign: "right" }}>{fmt(totalHours)}</td>
                <td style={{ padding: "1px 2px", textAlign: "right" }}>—</td>
                <td style={{ padding: "1px 2px", textAlign: "right" }}>—</td>
                <td style={{ padding: "1px 2px", textAlign: "right" }}>—</td>
              </tr>
            </tbody>
          </table>

          {/* Deductions header + columns on same line */}
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2px", fontSize: "7px", fontWeight: "bold", marginTop: "2px" }}>
            <span>DEDUCTIONS</span>
            <div style={{ display: "flex", gap: "8px" }}>
              <span style={{ width: "35px", textAlign: "right" }}>CURRENT</span>
              <span style={{ width: "35px", textAlign: "right" }}>YTD</span>
            </div>
          </div>

          {/* Gross Pay row */}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", borderBottom: "1px solid #999", marginBottom: "1px" }}>
            <span style={{ fontWeight: "bold", fontSize: "8px" }}>GROSS PAY</span>
            <div style={{ display: "flex", gap: "8px" }}>
              <span style={{ width: "35px", textAlign: "right", fontWeight: "bold", fontSize: "8px" }}>${fmt(grossPay)}</span>
              <span style={{ width: "35px", textAlign: "right", fontWeight: "bold", fontSize: "8px" }}>${fmt(item.ytdGross)}</span>
            </div>
          </div>

          {/* Total Deductions row */}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", borderBottom: "1px solid #999", marginBottom: "2px" }}>
            <span style={{ fontSize: "8px" }}>TOTAL DEDUCTIONS</span>
            <div style={{ display: "flex", gap: "8px" }}>
              <span style={{ width: "35px", textAlign: "right", fontWeight: "bold", fontSize: "8px" }}>${fmt(totalDeductions)}</span>
              <span style={{ width: "35px", textAlign: "right", fontWeight: "bold", fontSize: "8px" }}>${fmt(item.ytdNet - item.ytdGross + totalDeductions)}</span>
            </div>
          </div>

          {/* Net Pay (prominent) */}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", fontWeight: "bold", fontSize: "9px" }}>
            <span>NET PAY</span>
            <div style={{ display: "flex", gap: "8px" }}>
              <span style={{ width: "35px", textAlign: "right" }}>${fmt(netPay)}</span>
              <span style={{ width: "35px", textAlign: "right" }}>${fmt(item.ytdNet)}</span>
            </div>
          </div>

          {/* SE Tax for contractors */}
          {isContractor && (
            <div style={{ marginTop: "2px", paddingTop: "2px", borderTop: "1px solid #4a90d9", fontSize: "7px", color: "#2b5ea7" }}>
              <div style={{ fontWeight: "bold", marginBottom: "2px" }}>SELF-EMPLOYMENT TAX REFERENCE</div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "1px" }}>
                <span>Social Security (SS) 12.4%</span>
                <span>${fmt(ssTaxCurrent)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "1px" }}>
                <span>Medicare 2.9%</span>
                <span>${fmt(medicareTaxCurrent)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: "bold" }}>
                <span>Total SE Tax 15.3%</span>
                <span>${fmt(totalSeTaxCurrent)}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Bottom third for StandardCheck: earnings & deductions detail ──
function StubDetailSection({
  item, worker, company, run, deductions, config, amendments = [],
}: {
  item: PayrollItem; worker: Worker; company: Company; run: PayrollRun; deductions: TaxDeduction[]; config: Record<string, boolean>; amendments?: PayStubAmendment[];
}) {
  const netPay = Number(item.netPay || 0);
  const grossPay = Number(item.grossPay || 0);
  const totalDeductions = Number(item.deductions || 0);
  const regularHours = Number(item.regularHours || 0);
  const overtimeHours = Number(item.overtimeHours || 0);
  const doubleTimeHours = Number(item.doubleTimeHours || 0);
  const totalHours = regularHours + overtimeHours + doubleTimeHours;
  const isContractor = worker.workerType === "contractor";
  const ytdGross = Number(item.ytdGross || 0);

  const SS_WAGE_BASE = 168600;
  const ssTaxCurrent = isContractor ? Math.min(grossPay, SS_WAGE_BASE) * 0.124 : 0;
  const medicareTaxCurrent = isContractor ? grossPay * 0.029 : 0;
  const totalSeTaxCurrent = ssTaxCurrent + medicareTaxCurrent;
  const ssTaxYtd = isContractor ? Math.min(ytdGross, SS_WAGE_BASE) * 0.124 : 0;
  const medicareTaxYtd = isContractor ? ytdGross * 0.029 : 0;
  const totalSeTaxYtd = ssTaxYtd + medicareTaxYtd;

  const taxDeductionBreakdown = deductions
    .filter(d => d.isActive && !d.isEmployerPaid && !d.isReferenceOnly)
    .filter(d => {
      const appliesTo = d.appliesTo || "all";
      if (appliesTo === "employee" && isContractor) return false;
      if (appliesTo === "contractor" && !isContractor) return false;
      return true;
    })
    .map(d => {
      let amount = 0;
      if (d.calculationType === "percentage") {
        const base = d.maxAmount ? Math.min(grossPay, Number(d.maxAmount)) : grossPay;
        amount = base * (Number(d.rate || 0) / 100);
      } else {
        amount = Number(d.rate || 0);
      }
      return { name: d.name, amount };
    })
    .filter(d => d.amount > 0);

  const workerAmendmentDeductions = (amendments || [])
    .filter(a => a.workerId === item.workerId && a.status === "active" && (a as any).amendmentType === "deduction")
    .map(a => ({ name: a.description || "Pay Stub Deduction", amount: Number(a.amount || 0) }))
    .filter(a => a.amount > 0);

  const deductionBreakdown = [...taxDeductionBreakdown, ...workerAmendmentDeductions];

  // Compute totals from the actual line items so the grand total always matches what's listed,
  // even if the payroll run hasn't been reprocessed since amendments were added.
  const computedTotalDeductions = deductionBreakdown.reduce((s, d) => s + d.amount, 0);
  const computedNetPay = grossPay - computedTotalDeductions;

  const ssnDigits = worker.ssn ? worker.ssn.replace(/\D/g, '') : '';
  const ssnLast4 = ssnDigits.length >= 4 ? ssnDigits.slice(-4) : ssnDigits || '—';
  const ssnDisplay = ssnDigits.length >= 4 ? `***-**-${ssnLast4}` : (worker.ssn ? worker.ssn : '—');
  const fmtDate = (d: string | null | undefined) => {
    if (!d) return '—';
    const parts = d.split('-');
    return parts.length === 3 ? `${parts[1]}/${parts[2]}/${parts[0]}` : d;
  };
  const platformLabel: Record<string, string> = {
    apple_pay: 'Apple Pay', cash_app: 'Cash App', paypal: 'PayPal', venmo: 'Venmo', zelle: 'Zelle'
  };
  const paymentMethodLabel = item.paymentMethod === 'check' ? 'Check'
    : item.paymentMethod === 'cash' ? 'Cash'
    : item.paymentMethod === 'direct_deposit' ? 'Direct Deposit'
    : '—';
  const paymentPlatformLabel = item.paymentPlatform ? (platformLabel[item.paymentPlatform] || item.paymentPlatform) : '';

  return (
    <div style={{ padding: "0.15in 0.4in 0.2in", fontSize: "10px", height: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column" }}>
      {/* Employee info header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "1px solid #000", paddingBottom: "5px", marginBottom: "6px" }}>
        <div>
          <div style={{ fontWeight: "bold", fontSize: "11px" }}>{worker.firstName} {worker.lastName}</div>
          {worker.address && <div>{worker.address}{worker.address2 ? `, ${worker.address2}` : ''}</div>}
          {(worker.city || worker.state || worker.zip) && (
            <div>{[worker.city, worker.state, worker.zip].filter(Boolean).join(', ')}</div>
          )}
          <div style={{ marginTop: "2px" }}>SSN: {ssnDisplay}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div><span style={{ fontWeight: "bold" }}>Pay Period:</span> {fmtDate(run.periodStart)} — {fmtDate(run.periodEnd)}</div>
          {run.processedAt && <div><span style={{ fontWeight: "bold" }}>Pay Date:</span> {fmtDate(new Date(run.processedAt).toISOString().split('T')[0])}</div>}
          <div style={{ marginTop: "2px" }}>
            <span style={{ fontWeight: "bold" }}>Payment:</span>{' '}
            {paymentMethodLabel}{paymentPlatformLabel ? ` — ${paymentPlatformLabel}` : ''}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: "16px", flex: 1 }}>
        {/* Earnings table */}
        {config.showEarningsDetail && (
          <div style={{ flex: 1 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #000" }}>
                  <th style={{ textAlign: "left", padding: "3px 2px", fontWeight: "bold" }}>EARNINGS</th>
                  <th style={{ textAlign: "right", padding: "3px 2px", fontWeight: "bold" }}>HOURS</th>
                  <th style={{ textAlign: "right", padding: "3px 2px", fontWeight: "bold" }}>RATE</th>
                  <th style={{ textAlign: "right", padding: "3px 2px", fontWeight: "bold" }}>CURRENT</th>
                  {config.showYtdTotals && <th style={{ textAlign: "right", padding: "3px 2px", fontWeight: "bold" }}>YTD</th>}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ padding: "2px" }}>Regular</td>
                  <td style={{ textAlign: "right", padding: "2px" }}>{fmt(item.regularHours)}</td>
                  <td style={{ textAlign: "right", padding: "2px" }}>${fmt(item.payRate)}</td>
                  <td style={{ textAlign: "right", padding: "2px" }}>${fmt(item.regularPay)}</td>
                  {config.showYtdTotals && <td style={{ textAlign: "right", padding: "2px" }}>${fmt(item.ytdGross)}</td>}
                </tr>
                {overtimeHours > 0 && (
                  <tr>
                    <td style={{ padding: "2px" }}>Overtime (1.5×)</td>
                    <td style={{ textAlign: "right", padding: "2px" }}>{fmt(item.overtimeHours)}</td>
                    <td style={{ textAlign: "right", padding: "2px" }}>${fmt(Number(item.payRate || 0) * 1.5)}</td>
                    <td style={{ textAlign: "right", padding: "2px" }}>${fmt(item.overtimePay)}</td>
                    {config.showYtdTotals && <td style={{ textAlign: "right", padding: "2px" }}>—</td>}
                  </tr>
                )}
                {doubleTimeHours > 0 && (
                  <tr>
                    <td style={{ padding: "2px" }}>Double Time (2×)</td>
                    <td style={{ textAlign: "right", padding: "2px" }}>{fmt(item.doubleTimeHours)}</td>
                    <td style={{ textAlign: "right", padding: "2px" }}>${fmt(Number(item.payRate || 0) * 2)}</td>
                    <td style={{ textAlign: "right", padding: "2px" }}>${fmt(item.doubleTimePay)}</td>
                    {config.showYtdTotals && <td style={{ textAlign: "right", padding: "2px" }}>—</td>}
                  </tr>
                )}
                <tr style={{ borderTop: "1px solid #666" }}>
                  <td style={{ padding: "2px", fontWeight: "bold" }}>TOTAL HOURS</td>
                  <td style={{ textAlign: "right", padding: "2px", fontWeight: "bold" }}>{fmt(totalHours)}</td>
                  <td colSpan={config.showYtdTotals ? 3 : 2}></td>
                </tr>
                <tr style={{ borderTop: "1px solid #000", fontWeight: "bold" }}>
                  <td style={{ padding: "2px" }}>GROSS PAY</td>
                  <td style={{ padding: "2px" }}></td>
                  <td style={{ padding: "2px" }}></td>
                  <td style={{ textAlign: "right", padding: "2px" }}>${fmt(item.grossPay)}</td>
                  {config.showYtdTotals && <td style={{ textAlign: "right", padding: "2px" }}>${fmt(item.ytdGross)}</td>}
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Deductions table */}
        {config.showDeductionsDetail && (
          <div style={{ flex: 1 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #000" }}>
                  <th style={{ textAlign: "left", padding: "3px 2px", fontWeight: "bold" }}>DEDUCTIONS</th>
                  <th style={{ textAlign: "right", padding: "3px 2px", fontWeight: "bold" }}>CURRENT</th>
                  {config.showYtdTotals && <th style={{ textAlign: "right", padding: "3px 2px", fontWeight: "bold" }}>YTD</th>}
                </tr>
              </thead>
              <tbody>
                {deductionBreakdown.map((d, i) => (
                  <tr key={i}>
                    <td style={{ padding: "2px" }}>{d.name}</td>
                    <td style={{ textAlign: "right", padding: "2px" }}>${fmt(d.amount)}</td>
                    {config.showYtdTotals && <td style={{ textAlign: "right", padding: "2px" }}>—</td>}
                  </tr>
                ))}
                {deductionBreakdown.length === 0 && (
                  <tr><td style={{ padding: "2px", color: "#999" }} colSpan={config.showYtdTotals ? 3 : 2}>No deductions</td></tr>
                )}
                <tr style={{ borderTop: "1px solid #000", fontWeight: "bold" }}>
                  <td style={{ padding: "2px" }}>TOTAL DEDUCTIONS</td>
                  <td style={{ textAlign: "right", padding: "2px" }}>${fmt(computedTotalDeductions)}</td>
                  {config.showYtdTotals && <td style={{ textAlign: "right", padding: "2px" }}>${fmt(item.ytdDeductions)}</td>}
                </tr>
                <tr style={{ borderTop: "2px solid #000", fontWeight: "bold" }}>
                  <td style={{ padding: "2px" }}>NET PAY</td>
                  <td style={{ textAlign: "right", padding: "2px" }}>${fmt(computedNetPay)}</td>
                  {config.showYtdTotals && <td style={{ textAlign: "right", padding: "2px" }}>${fmt(item.ytdNet)}</td>}
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* SE Tax reference for contractors */}
      {isContractor && (
        <div style={{ marginTop: "8px", border: "1px solid #4a90d9", padding: "6px 8px", background: "#f0f5ff" }}>
          <div style={{ fontWeight: "bold", fontSize: "9px", color: "#2b5ea7", marginBottom: "4px" }}>
            SELF-EMPLOYMENT TAX REFERENCE — NOT DEDUCTED FROM PAY
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #4a90d9" }}>
                <th style={{ textAlign: "left", padding: "2px", fontSize: "8px", color: "#2b5ea7" }}>DESCRIPTION</th>
                <th style={{ textAlign: "right", padding: "2px", fontSize: "8px", color: "#2b5ea7" }}>RATE</th>
                <th style={{ textAlign: "right", padding: "2px", fontSize: "8px", color: "#2b5ea7" }}>CURRENT</th>
                {config.showYtdTotals && <th style={{ textAlign: "right", padding: "2px", fontSize: "8px", color: "#2b5ea7" }}>YTD</th>}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ padding: "1px 2px", color: "#2b5ea7" }}>Social Security (SSI)</td>
                <td style={{ textAlign: "right", padding: "1px 2px", color: "#2b5ea7" }}>12.4%</td>
                <td style={{ textAlign: "right", padding: "1px 2px", color: "#2b5ea7" }}>${fmt(ssTaxCurrent)}</td>
                {config.showYtdTotals && <td style={{ textAlign: "right", padding: "1px 2px", color: "#2b5ea7" }}>${fmt(ssTaxYtd)}</td>}
              </tr>
              <tr>
                <td style={{ padding: "1px 2px", color: "#2b5ea7" }}>Medicare</td>
                <td style={{ textAlign: "right", padding: "1px 2px", color: "#2b5ea7" }}>2.9%</td>
                <td style={{ textAlign: "right", padding: "1px 2px", color: "#2b5ea7" }}>${fmt(medicareTaxCurrent)}</td>
                {config.showYtdTotals && <td style={{ textAlign: "right", padding: "1px 2px", color: "#2b5ea7" }}>${fmt(medicareTaxYtd)}</td>}
              </tr>
              <tr style={{ borderTop: "1px solid #4a90d9", fontWeight: "bold" }}>
                <td style={{ padding: "2px", color: "#2b5ea7" }}>Total SE Tax</td>
                <td style={{ textAlign: "right", padding: "2px", color: "#2b5ea7" }}>15.3%</td>
                <td style={{ textAlign: "right", padding: "2px", color: "#2b5ea7" }}>${fmt(totalSeTaxCurrent)}</td>
                {config.showYtdTotals && <td style={{ textAlign: "right", padding: "2px", color: "#2b5ea7" }}>${fmt(totalSeTaxYtd)}</td>}
              </tr>
            </tbody>
          </table>
          <div style={{ fontSize: "7px", color: "#555", marginTop: "3px" }}>
            As an independent contractor, you are responsible for paying self-employment tax (SSI 12.4% + Medicare 2.9% = 15.3%) directly to the IRS. SS applies to first ${SS_WAGE_BASE.toLocaleString()} of earnings.
          </div>
        </div>
      )}

      <div style={{ marginTop: "6px", textAlign: "center", fontSize: "8px", color: "#999", borderTop: "1px solid #ccc", paddingTop: "4px" }}>
        This is a computer-generated document. {company.name} {company.ein ? `- EIN: ${company.ein}` : ""}
      </div>
    </div>
  );
}

// ── Original single-section stub (used by VoucherCheck + ThreePartCheck) ──
function StubPortion({
  item, worker, company, run, deductions, config, payStubAccounts = [], accrualAccounts = [], accrualBalances = [], amendments = [],
}: {
  item: PayrollItem; worker: Worker; company: Company; run: PayrollRun; deductions: TaxDeduction[]; config: Record<string, boolean>; payStubAccounts?: PayStubAccount[]; accrualAccounts?: AccrualAccount[]; accrualBalances?: AccrualBalance[]; amendments?: PayStubAmendment[];
}) {
  const netPay = Number(item.netPay || 0);
  const grossPay = Number(item.grossPay || 0);
  const totalDeductions = Number(item.deductions || 0);
  const regularHours = Number(item.regularHours || 0);
  const overtimeHours = Number(item.overtimeHours || 0);
  const doubleTimeHours = Number(item.doubleTimeHours || 0);
  const totalHours = regularHours + overtimeHours + doubleTimeHours;

  const workerAccrualBalances = accrualBalances.filter(b => b.workerId === worker.id);
  const sickAccounts = accrualAccounts.filter(a => a.type === "sick" && a.isActive);
  const workerLeaveBalances = workerAccrualBalances
    .map(b => {
      const account = accrualAccounts.find(a => a.id === b.accrualAccountId);
      if (!account || !account.isActive) return null;
      return { name: account.name, type: account.type, balance: Number(b.balance || 0), used: Number(b.usedHours || 0) };
    })
    .filter((b): b is NonNullable<typeof b> => b !== null);

  const isContractor = worker.workerType === "contractor";
  const ytdGross = Number(item.ytdGross || 0);

  const taxDeductionBreakdown = deductions
    .filter(d => d.isActive && !d.isEmployerPaid && !d.isReferenceOnly)
    .filter(d => {
      const appliesTo = d.appliesTo || "all";
      if (appliesTo === "employee" && isContractor) return false;
      if (appliesTo === "contractor" && !isContractor) return false;
      return true;
    })
    .map(d => {
      let amount = 0;
      if (d.calculationType === "percentage") {
        const base = d.maxAmount ? Math.min(grossPay, Number(d.maxAmount)) : grossPay;
        amount = base * (Number(d.rate || 0) / 100);
      } else {
        amount = Number(d.rate || 0);
      }
      return { name: d.name, amount };
    })
    .filter(d => d.amount > 0);

  const workerAmendmentDeductions = (amendments || [])
    .filter(a => a.workerId === item.workerId && a.status === "active" && (a as any).amendmentType === "deduction")
    .map(a => ({ name: a.description || "Pay Stub Deduction", amount: Number(a.amount || 0) }))
    .filter(a => a.amount > 0);

  const deductionBreakdown = [...taxDeductionBreakdown, ...workerAmendmentDeductions];

  // Compute totals from the actual line items so the grand total always matches what's listed,
  // even if the payroll run hasn't been reprocessed since amendments were added.
  const computedTotalDeductions = deductionBreakdown.reduce((s, d) => s + d.amount, 0);
  const computedNetPay = grossPay - computedTotalDeductions;

  // SE Tax reference (always computed for contractors — not deducted, for reference only)
  const SS_WAGE_BASE = 168600;
  const ssTaxCurrent = isContractor ? Math.min(grossPay, SS_WAGE_BASE) * 0.124 : 0;
  const medicareTaxCurrent = isContractor ? grossPay * 0.029 : 0;
  const totalSeTaxCurrent = ssTaxCurrent + medicareTaxCurrent;
  // YTD SE tax — computed from ytdGross (SS capped at wage base)
  const ssTaxYtd = isContractor ? Math.min(ytdGross, SS_WAGE_BASE) * 0.124 : 0;
  const medicareTaxYtd = isContractor ? ytdGross * 0.029 : 0;
  const totalSeTaxYtd = ssTaxYtd + medicareTaxYtd;

  return (
    <div style={{ padding: "0.2in 0.4in", fontSize: "10px", height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {config.showCompanyLogo && company.logoUrl && (
            <img src={company.logoUrl} alt="" style={{ height: "28px", width: "28px", objectFit: "contain" }} />
          )}
          <div>
            {config.showCompanyName && <div style={{ fontSize: "12px", fontWeight: "bold" }}>PAY STUB — {company.name}</div>}
            {!config.showCompanyName && <div style={{ fontSize: "12px", fontWeight: "bold" }}>PAY STUB</div>}
            {company.ein && <div>EIN: {company.ein}</div>}
            {config.showCompanyAddress && company.address && <div>{company.address}</div>}
            {config.showCompanyAddress && (company.city || company.state || company.zip) && (
              <div>{[company.city, company.state].filter(Boolean).join(", ")} {company.zip}</div>
            )}
            {config.showCompanyAddress && company.phone && <div>{company.phone}</div>}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div><strong>{isContractor ? "Contractor" : "Employee"}:</strong> {worker.firstName} {worker.lastName}</div>
          <div><strong>{isContractor ? "Contractor" : "Employee"} #:</strong> {worker.employeeNumber || "—"}</div>
          <div><strong>SSN:</strong> {worker.ssn ? "XXX-XX-" + worker.ssn.slice(-4) : "XXX-XX-XXXX"}</div>
        </div>
      </div>

      {config.showPayPeriod && (
        <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "2px solid #000", paddingBottom: "4px", marginBottom: "8px" }}>
          <div><strong>Pay Period:</strong> {run.periodStart} to {run.periodEnd}</div>
          {config.showCheckNumber && <div><strong>Check #:</strong> {item.checkNumber || "—"}</div>}
          <div><strong>Pay Date:</strong> {run.processedAt ? new Date(run.processedAt).toLocaleDateString() : "—"}</div>
        </div>
      )}

      <div style={{ display: "flex", gap: "16px", flex: 1 }}>
        {config.showEarningsDetail && (
          <div style={{ flex: 1 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #000" }}>
                  <th style={{ textAlign: "left", padding: "3px 2px", fontWeight: "bold" }}>EARNINGS</th>
                  <th style={{ textAlign: "right", padding: "3px 2px", fontWeight: "bold" }}>HOURS</th>
                  <th style={{ textAlign: "right", padding: "3px 2px", fontWeight: "bold" }}>RATE</th>
                  <th style={{ textAlign: "right", padding: "3px 2px", fontWeight: "bold" }}>CURRENT</th>
                  {config.showYtdTotals && <th style={{ textAlign: "right", padding: "3px 2px", fontWeight: "bold" }}>YTD</th>}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ padding: "2px" }}>Regular</td>
                  <td style={{ textAlign: "right", padding: "2px" }}>{fmt(item.regularHours)}</td>
                  <td style={{ textAlign: "right", padding: "2px" }}>${fmt(item.payRate)}</td>
                  <td style={{ textAlign: "right", padding: "2px" }}>${fmt(item.regularPay)}</td>
                  {config.showYtdTotals && <td style={{ textAlign: "right", padding: "2px" }}>${fmt(item.ytdGross)}</td>}
                </tr>
                {overtimeHours > 0 && (
                  <tr>
                    <td style={{ padding: "2px" }}>Overtime</td>
                    <td style={{ textAlign: "right", padding: "2px" }}>{fmt(item.overtimeHours)}</td>
                    <td style={{ textAlign: "right", padding: "2px" }}>${fmt(Number(item.payRate || 0) * 1.5)}</td>
                    <td style={{ textAlign: "right", padding: "2px" }}>${fmt(item.overtimePay)}</td>
                    {config.showYtdTotals && <td style={{ textAlign: "right", padding: "2px" }}>—</td>}
                  </tr>
                )}
                {doubleTimeHours > 0 && (
                  <tr>
                    <td style={{ padding: "2px" }}>Double Time</td>
                    <td style={{ textAlign: "right", padding: "2px" }}>{fmt(item.doubleTimeHours)}</td>
                    <td style={{ textAlign: "right", padding: "2px" }}>${fmt(Number(item.payRate || 0) * 2)}</td>
                    <td style={{ textAlign: "right", padding: "2px" }}>${fmt(item.doubleTimePay)}</td>
                    {config.showYtdTotals && <td style={{ textAlign: "right", padding: "2px" }}>—</td>}
                  </tr>
                )}
                <tr style={{ borderTop: "1px solid #666" }}>
                  <td style={{ padding: "2px", fontWeight: "bold" }}>TOTAL HOURS</td>
                  <td style={{ textAlign: "right", padding: "2px", fontWeight: "bold" }}>{fmt(totalHours)}</td>
                  <td style={{ padding: "2px" }}></td>
                  <td style={{ padding: "2px" }}></td>
                  {config.showYtdTotals && <td style={{ padding: "2px" }}></td>}
                </tr>
                <tr style={{ borderTop: "1px solid #000", fontWeight: "bold" }}>
                  <td style={{ padding: "2px" }}>GROSS PAY</td>
                  <td style={{ textAlign: "right", padding: "2px" }}>{fmt(totalHours)}</td>
                  <td style={{ padding: "2px" }}></td>
                  <td style={{ textAlign: "right", padding: "2px" }}>${fmt(item.grossPay)}</td>
                  {config.showYtdTotals && <td style={{ textAlign: "right", padding: "2px" }}>${fmt(item.ytdGross)}</td>}
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {config.showDeductionsDetail && (
          <div style={{ flex: 1 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #000" }}>
                  <th style={{ textAlign: "left", padding: "3px 2px", fontWeight: "bold" }}>DEDUCTIONS</th>
                  <th style={{ textAlign: "right", padding: "3px 2px", fontWeight: "bold" }}>CURRENT</th>
                  {config.showYtdTotals && <th style={{ textAlign: "right", padding: "3px 2px", fontWeight: "bold" }}>YTD</th>}
                </tr>
              </thead>
              <tbody>
                {deductionBreakdown.map((d, i) => (
                  <tr key={i}>
                    <td style={{ padding: "2px" }}>{d.name}</td>
                    <td style={{ textAlign: "right", padding: "2px" }}>${fmt(d.amount)}</td>
                    {config.showYtdTotals && <td style={{ textAlign: "right", padding: "2px" }}>—</td>}
                  </tr>
                ))}
                {deductionBreakdown.length === 0 && (
                  <tr><td style={{ padding: "2px", color: "#999" }} colSpan={config.showYtdTotals ? 3 : 2}>No deductions</td></tr>
                )}
                <tr style={{ borderTop: "1px solid #000", fontWeight: "bold" }}>
                  <td style={{ padding: "2px" }}>TOTAL DEDUCTIONS</td>
                  <td style={{ textAlign: "right", padding: "2px" }}>${fmt(computedTotalDeductions)}</td>
                  {config.showYtdTotals && <td style={{ textAlign: "right", padding: "2px" }}>${fmt(item.ytdDeductions)}</td>}
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {config.showYtdTotals && (
        <div style={{ marginTop: "8px", borderTop: "2px solid #000", paddingTop: "6px" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div style={{ display: "flex", gap: "30px" }}>
              <div><div style={{ fontSize: "8px", color: "#666" }}>GROSS PAY</div><div style={{ fontSize: "12px", fontWeight: "bold" }}>${fmt(grossPay)}</div></div>
              <div><div style={{ fontSize: "8px", color: "#666" }}>DEDUCTIONS</div><div style={{ fontSize: "12px", fontWeight: "bold" }}>${fmt(computedTotalDeductions)}</div></div>
              <div><div style={{ fontSize: "8px", color: "#666" }}>NET PAY</div><div style={{ fontSize: "12px", fontWeight: "bold" }}>${fmt(computedNetPay)}</div></div>
            </div>
            <div style={{ display: "flex", gap: "20px" }}>
              <div><div style={{ fontSize: "8px", color: "#666" }}>YTD GROSS</div><div style={{ fontWeight: "bold" }}>${fmt(item.ytdGross)}</div></div>
              <div><div style={{ fontSize: "8px", color: "#666" }}>YTD DEDUCTIONS</div><div style={{ fontWeight: "bold" }}>${fmt(item.ytdDeductions)}</div></div>
              <div><div style={{ fontSize: "8px", color: "#666" }}>YTD NET</div><div style={{ fontWeight: "bold" }}>${fmt(item.ytdNet)}</div></div>
            </div>
          </div>
        </div>
      )}

      {isContractor && (
        <div style={{ marginTop: "8px", border: "1px solid #4a90d9", padding: "6px 8px", background: "#f0f5ff" }}>
          <div style={{ fontWeight: "bold", fontSize: "9px", color: "#2b5ea7", marginBottom: "4px" }}>
            SELF-EMPLOYMENT TAX REFERENCE — NOT DEDUCTED FROM PAY
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #4a90d9" }}>
                <th style={{ textAlign: "left", padding: "2px", fontSize: "8px", color: "#2b5ea7" }}>DESCRIPTION</th>
                <th style={{ textAlign: "right", padding: "2px", fontSize: "8px", color: "#2b5ea7" }}>RATE</th>
                <th style={{ textAlign: "right", padding: "2px", fontSize: "8px", color: "#2b5ea7" }}>CURRENT</th>
                {config.showYtdTotals && <th style={{ textAlign: "right", padding: "2px", fontSize: "8px", color: "#2b5ea7" }}>YTD</th>}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ padding: "1px 2px", color: "#2b5ea7" }}>Social Security (SSI)</td>
                <td style={{ textAlign: "right", padding: "1px 2px", color: "#2b5ea7" }}>12.4%</td>
                <td style={{ textAlign: "right", padding: "1px 2px", color: "#2b5ea7" }}>${fmt(ssTaxCurrent)}</td>
                {config.showYtdTotals && <td style={{ textAlign: "right", padding: "1px 2px", color: "#2b5ea7" }}>${fmt(ssTaxYtd)}</td>}
              </tr>
              <tr>
                <td style={{ padding: "1px 2px", color: "#2b5ea7" }}>Medicare</td>
                <td style={{ textAlign: "right", padding: "1px 2px", color: "#2b5ea7" }}>2.9%</td>
                <td style={{ textAlign: "right", padding: "1px 2px", color: "#2b5ea7" }}>${fmt(medicareTaxCurrent)}</td>
                {config.showYtdTotals && <td style={{ textAlign: "right", padding: "1px 2px", color: "#2b5ea7" }}>${fmt(medicareTaxYtd)}</td>}
              </tr>
              <tr style={{ borderTop: "1px solid #4a90d9", fontWeight: "bold" }}>
                <td style={{ padding: "2px", color: "#2b5ea7" }}>Total SE Tax</td>
                <td style={{ textAlign: "right", padding: "2px", color: "#2b5ea7" }}>15.3%</td>
                <td style={{ textAlign: "right", padding: "2px", color: "#2b5ea7" }}>${fmt(totalSeTaxCurrent)}</td>
                {config.showYtdTotals && <td style={{ textAlign: "right", padding: "2px", color: "#2b5ea7" }}>${fmt(totalSeTaxYtd)}</td>}
              </tr>
            </tbody>
          </table>
          <div style={{ fontSize: "7px", color: "#555", marginTop: "3px" }}>
            As an independent contractor, you are responsible for paying self-employment tax (SSI 12.4% + Medicare 2.9% = 15.3%) directly to the IRS. SS applies to first ${SS_WAGE_BASE.toLocaleString()} of earnings. These amounts are for reference only and are NOT deducted from your pay.
          </div>
        </div>
      )}

      {!isContractor && workerLeaveBalances.length > 0 && (
        <div style={{ marginTop: "8px", border: "1px solid #999", padding: "6px 8px" }}>
          <div style={{ fontWeight: "bold", fontSize: "9px", marginBottom: "4px" }}>
            LEAVE BALANCES
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #999" }}>
                <th style={{ textAlign: "left", padding: "2px", fontSize: "9px" }}>TYPE</th>
                <th style={{ textAlign: "right", padding: "2px", fontSize: "9px" }}>AVAILABLE (HRS)</th>
                <th style={{ textAlign: "right", padding: "2px", fontSize: "9px" }}>USED (HRS)</th>
              </tr>
            </thead>
            <tbody>
              {workerLeaveBalances.map((lb, i) => (
                <tr key={i}>
                  <td style={{ padding: "2px" }}>{lb.name}</td>
                  <td style={{ textAlign: "right", padding: "2px" }}>{fmt(lb.balance)}</td>
                  <td style={{ textAlign: "right", padding: "2px" }}>{fmt(lb.used)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!isContractor && workerLeaveBalances.length === 0 && sickAccounts.length > 0 && (
        <div style={{ marginTop: "8px", border: "1px solid #999", padding: "6px 8px" }}>
          <div style={{ fontWeight: "bold", fontSize: "9px", marginBottom: "4px" }}>
            LEAVE BALANCES
          </div>
          <div style={{ fontSize: "9px", color: "#666" }}>Sick Leave: 0.00 hrs available</div>
        </div>
      )}

      <div style={{ marginTop: "6px", textAlign: "center", fontSize: "8px", color: "#999", borderTop: "1px solid #ccc", paddingTop: "4px" }}>
        This is a computer-generated document. {company.name} {company.ein ? `- EIN: ${company.ein}` : ""}
      </div>
    </div>
  );
}

interface CheckProps {
  item: PayrollItem; worker: Worker; company: Company; run: PayrollRun; deductions: TaxDeduction[]; config: Record<string, boolean>; payStubAccounts: PayStubAccount[]; accrualAccounts: AccrualAccount[]; accrualBalances: AccrualBalance[]; amendments?: PayStubAmendment[]; remittanceSources?: RemittanceSource[];
}

function computeCheckNetPay(item: PayrollItem, worker: Worker, deductions: TaxDeduction[], amendments: PayStubAmendment[]): number {
  const grossPay = Number(item.grossPay || 0);
  const isContractor = worker.workerType === "contractor";
  const taxLines = deductions
    .filter(d => d.isActive && !d.isEmployerPaid && !d.isReferenceOnly)
    .filter(d => {
      const appliesTo = d.appliesTo || "all";
      if (appliesTo === "employee" && isContractor) return false;
      if (appliesTo === "contractor" && !isContractor) return false;
      return true;
    })
    .map(d => {
      if (d.calculationType === "percentage") {
        const base = d.maxAmount ? Math.min(grossPay, Number(d.maxAmount)) : grossPay;
        return base * (Number(d.rate || 0) / 100);
      }
      return Number(d.rate || 0);
    })
    .filter(a => a > 0);
  const amendLines = amendments
    .filter(a => a.workerId === item.workerId && a.status === "active" && (a as any).amendmentType === "deduction")
    .map(a => Number(a.amount || 0))
    .filter(a => a > 0);
  const totalDed = [...taxLines, ...amendLines].reduce((s, v) => s + v, 0);
  return grossPay - totalDed;
}

function StandardCheck({ item, worker, company, run, deductions, config, payStubAccounts, accrualAccounts, accrualBalances, amendments = [], remittanceSources = [] }: CheckProps) {
  const computedNetPay = computeCheckNetPay(item, worker, deductions, amendments);
  return (
    <div className="check-page" style={{ width: "8.5in", height: "11in", pageBreakAfter: "always", fontFamily: "'Arial', 'Helvetica Neue', Helvetica, sans-serif" }}>
      {/* Top third: the actual check */}
      <div style={{ height: "3.667in" }}>
        <CheckPortion item={item} worker={worker} company={company} run={run} config={config} overrideNetPay={computedNetPay} remittanceSources={remittanceSources} />
      </div>
      {/* Middle third: pay stub summary */}
      <div style={{ height: "3.667in" }}>
        <StubSummarySection item={item} worker={worker} company={company} run={run} config={config} deductions={deductions} accrualAccounts={accrualAccounts} accrualBalances={accrualBalances} />
      </div>
      {/* Bottom third: earnings & deductions detail */}
      <div style={{ height: "3.666in" }}>
        <StubDetailSection item={item} worker={worker} company={company} run={run} deductions={deductions} config={config} amendments={amendments} />
      </div>
    </div>
  );
}

function VoucherCheck({ item, worker, company, run, deductions, config, payStubAccounts, accrualAccounts, accrualBalances, amendments = [], remittanceSources = [] }: CheckProps) {
  const computedNetPay = computeCheckNetPay(item, worker, deductions, amendments);
  return (
    <div className="check-page" style={{ width: "8.5in", height: "11in", pageBreakAfter: "always", fontFamily: "'Arial', 'Helvetica Neue', Helvetica, sans-serif" }}>
      <div style={{ height: "3.333in" }}>
        <StubPortion item={item} worker={worker} company={company} run={run} deductions={deductions} config={config} payStubAccounts={payStubAccounts} accrualAccounts={accrualAccounts} accrualBalances={accrualBalances} amendments={amendments} />
      </div>
      <div style={{ height: "3.667in" }}>
        <CheckPortion item={item} worker={worker} company={company} run={run} config={config} overrideNetPay={computedNetPay} remittanceSources={remittanceSources} />
      </div>
      <div style={{ height: "4in" }}>
        <StubPortion item={item} worker={worker} company={company} run={run} deductions={deductions} config={config} payStubAccounts={payStubAccounts} accrualAccounts={accrualAccounts} accrualBalances={accrualBalances} amendments={amendments} />
      </div>
    </div>
  );
}

function ThreePartCheck({ item, worker, company, run, deductions, config, payStubAccounts, accrualAccounts, accrualBalances, amendments = [] }: CheckProps) {
  return (
    <div className="check-page" style={{ width: "8.5in", height: "11in", pageBreakAfter: "always", fontFamily: "'Arial', 'Helvetica Neue', Helvetica, sans-serif" }}>
      <div style={{ height: "3.667in" }}>
        <StubPortion item={item} worker={worker} company={company} run={run} deductions={deductions} config={config} payStubAccounts={payStubAccounts} accrualAccounts={accrualAccounts} accrualBalances={accrualBalances} amendments={amendments} />
      </div>
      <div style={{ height: "3.667in" }}>
        <StubPortion item={item} worker={worker} company={company} run={run} deductions={deductions} config={config} payStubAccounts={payStubAccounts} accrualAccounts={accrualAccounts} accrualBalances={accrualBalances} amendments={amendments} />
      </div>
      <div style={{ height: "3.666in" }}>
        <StubPortion item={item} worker={worker} company={company} run={run} deductions={deductions} config={config} payStubAccounts={payStubAccounts} accrualAccounts={accrualAccounts} accrualBalances={accrualBalances} amendments={amendments} />
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
  const { data: payStubAccounts = [] } = useQuery<PayStubAccount[]>({ queryKey: ["/api/pay-stub-accounts"] });
  const { data: accrualAccountsList = [] } = useQuery<AccrualAccount[]>({ queryKey: ["/api/accrual-accounts"] });
  const { data: accrualBalancesList = [] } = useQuery<AccrualBalance[]>({ queryKey: ["/api/accrual-balances"] });
  const { data: amendments = [] } = useQuery<PayStubAmendment[]>({ queryKey: ["/api/pay-stub-amendments"] });
  const { data: remittanceSources = [] } = useQuery<RemittanceSource[]>({ queryKey: ["/api/remittance-sources"] });

  const company = run ? companies.find(c => c.id === run.companyId) : undefined;

  const { data: templates = [] } = useQuery<CheckTemplate[]>({
    queryKey: ["/api/check-templates", company?.id],
    queryFn: async () => {
      const res = await fetch(`/api/check-templates?companyId=${company!.id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch templates");
      return res.json();
    },
    enabled: !!company?.id,
  });

  const activeTemplate = templates.find(t => t.isDefault) || templates[0];
  let templateType = activeTemplate?.templateType || "standard";
  let config: Record<string, boolean>;
  try {
    config = activeTemplate?.layoutConfig ? JSON.parse(activeTemplate.layoutConfig) : { ...DEFAULT_CONFIG };
  } catch {
    config = { ...DEFAULT_CONFIG };
  }
  Object.keys(DEFAULT_CONFIG).forEach(k => {
    if (config[k] === undefined) config[k] = (DEFAULT_CONFIG as any)[k];
  });

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

  const companyDeductions = taxesDeductions.filter(d => d.companyId === run.companyId);
  const companyPSAccounts = payStubAccounts.filter(a => a.companyId === run.companyId);
  const companyAccrualAccounts = accrualAccountsList.filter(a => a.companyId === run.companyId);
  const getWorker = (id: string) => workers.find(w => w.id === id);

  const CheckComponent = templateType === "voucher" ? VoucherCheck :
    templateType === "three-part" ? ThreePartCheck : StandardCheck;

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
        <span className="text-sm text-muted-foreground" data-testid="text-check-info">
          {items.length} check(s) for {company?.name || ""} — Template: {activeTemplate?.name || "Default"}
        </span>
      </div>

      <div className="print-content">
        {items.map((item) => {
          const worker = getWorker(item.workerId);
          if (!worker || !company) return null;
          return (
            <CheckComponent
              key={item.id}
              item={item}
              worker={worker}
              company={company}
              run={run}
              deductions={companyDeductions}
              config={config}
              payStubAccounts={companyPSAccounts}
              accrualAccounts={companyAccrualAccounts}
              accrualBalances={accrualBalancesList}
              amendments={amendments}
              remittanceSources={remittanceSources}
            />
          );
        })}
      </div>

      <style>{`
        @media print {
          @page { size: 8.5in 11in; margin: 0; }
          .print-hide { display: none !important; }
          .check-page { page-break-after: always; }
          .print-content { display: block; }
        }
        @media screen {
          body { background: #e5e7eb; margin: 0; }
          .print-content {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 20px;
            padding: 20px;
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
