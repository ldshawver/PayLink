import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { useParams, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Printer, ArrowLeft, FileText, Lock, AlertTriangle, XCircle, CheckCircle2, ChevronDown, ChevronRight, ExternalLink, Settings2, Save, RefreshCcw, Crosshair } from "lucide-react";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
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
  showMicrLine: true,            // Render E-13B MICR line (micrenc.ttf, ANSI X9.100 compliant)
  showBankReference: false,      // Non-MICR labeled section — disabled now that MICR line is active
  showEarningsDetail: true,
  showDeductionsDetail: true,
  showYtdTotals: true,
  showPayPeriod: true,
  showEmployeeAddress: true,
};

type CheckCalibration = {
  globalTop: number;
  globalLeft: number;
  dateTop: number;
  amountWordsTop: number;
  memoTop: number;
  signatureTop: number;
};

const DEFAULT_CALIBRATION: CheckCalibration = {
  globalTop: 0,
  globalLeft: 0,
  dateTop: 0,
  amountWordsTop: 0,
  memoTop: 0,
  signatureTop: 0,
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

// ── MICR E-13B Line ──
// ANSI X9.100-160-1-2009 / CPA006 compliant US check MICR line.
// Font: micrenc.ttf (installed at /fonts/micrenc.ttf, served by Express static middleware).
// Character mapping for micrenc.ttf (E-13B):
//   Transit ⑆ → 'c'    On-Us ⑈ → 'd'    Amount ⑇ → 'b'    Dash ⑉ → 'a'
//
// To switch to ConnectCodeMICRT_X9 (X9.100 strict), change font to 'ConnectCodeMICR'
// and update T=':' O=';' accordingly.
//
// US check MICR line layout (left to right, ANSI X9.27 / X9.100-160):
//   Positions 45–58 (AuxONUS):  d + check# right-just(10) + d
//   Position 44 (EPC):          space
//   Positions 33–43 (Transit):  c + routing(9 digits) + c
//   space separator
//   Positions 13–32 (ON-US):    account(up to 17 chars) + d
//   Positions 1–12 (Amount):    12-char clear zone — bank fills this field

function buildMicrString(routing: string, account: string, checkNum: string): string {
  const T = "c"; // Transit symbol ⑆ in micrenc.ttf
  const O = "d"; // On-Us symbol  ⑈ in micrenc.ttf

  const r = routing.replace(/\D/g, "").slice(0, 9).padStart(9, "0");
  const a = account.replace(/\D/g, "").slice(0, 17);
  // Check number right-justified in 10 characters (pad with spaces)
  const chk = checkNum.replace(/\D/g, "").slice(0, 10).padStart(10, " ");

  // AuxONUS[d+check10+d] + EPC[space] + Transit[c+routing9+c] + sep[space] + ON-US[account+d]
  return `${O}${chk}${O} ${T}${r}${T} ${a}${O}`;
}

function MicrLine({
  routing, account, checkNum,
}: {
  routing: string; account: string; checkNum: string;
}) {
  if (!routing || routing.length < 9 || !account || !checkNum) return null;
  const micrStr = buildMicrString(routing, account, checkNum);
  return (
    <div
      style={{
        fontFamily: "'MICRNumeric', monospace",
        fontSize: "13pt",
        lineHeight: 1,
        whiteSpace: "pre",
        color: "#000000",
        letterSpacing: "0",
        userSelect: "none",
      }}
      aria-hidden="true"
    >
      {micrStr}
    </div>
  );
}

function CheckPortion({
  item, worker, company, run, config, overrideNetPay, remittanceSources = [],
  calibration, showGuides = false,
}: {
  item: PayrollItem; worker: Worker; company: Company; run: PayrollRun; config: Record<string, boolean>; overrideNetPay?: number; remittanceSources?: RemittanceSource[];
  calibration?: CheckCalibration;
  showGuides?: boolean;
}) {
  const remittanceSource = remittanceSources.find(s => s.companyId === company.id && s.status === "enabled") || remittanceSources.find(s => s.companyId === company.id);
  const netPay = overrideNetPay !== undefined ? overrideNetPay : Number(item.netPay || 0);
  const checkDate = run.payDate
    ? new Date(run.payDate + "T00:00:00").toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" })
    : "—";
  const periodStart = run.periodStart ? new Date(run.periodStart + "T00:00:00").toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" }) : "";
  const periodEnd = run.periodEnd ? new Date(run.periodEnd + "T00:00:00").toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" }) : "";
  const memoText = periodStart && periodEnd ? `Pay period ${periodStart} – ${periodEnd}` : "";

  // Routing / account from remittance source — no silent fallback values
  const routing = (remittanceSource?.routingNumber || "").replace(/\D/g, "");
  const account = (remittanceSource?.accountNumber || "").replace(/\D/g, "");
  const checkNum = String(item.checkNumber || "").replace(/\D/g, "").padStart(4, "0");
  // Only render MICR if all required banking fields are present and valid length
  const micrReady = routing.length === 9 && account.length >= 4 && !!(item.checkNumber);
  const institutionName = remittanceSource?.institution || "";

  // Calibration offsets — prefer explicit calibration prop, fall back to remittance source legacy fields
  const cal = calibration ?? DEFAULT_CALIBRATION;
  const gTop = cal.globalTop !== 0 ? cal.globalTop : Number(remittanceSource?.verticalAlignment || 0);
  const gLeft = cal.globalLeft !== 0 ? cal.globalLeft : Number(remittanceSource?.horizontalAlignment || 0);

  // Guide marker helper — only visible in calibration test mode
  const guideStyle = (color: string): React.CSSProperties => showGuides ? {
    outline: `2px dashed ${color}`,
    outlineOffset: "2px",
    position: "relative",
  } : {};

  return (
    // Total height: 3.667in.  Bottom 0.625in reserved for MICR band (ANSI X9.27).
    // Content area: top 3.042in with standard check-stock layout.
    <div style={{ height: "3.667in", boxSizing: "border-box", display: "flex", flexDirection: "column", fontFamily: "'Arial', 'Helvetica Neue', Helvetica, sans-serif", position: "relative", top: gTop ? `${gTop}in` : undefined, left: gLeft ? `${gLeft}in` : undefined, outline: showGuides ? "2px dashed #7c3aed" : undefined }}>

      {/* ── CONTENT AREA (top 3.042in) ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "0.22in 0.55in 0.18in" }}>

        {/* ROW 1: Company issuer block (left) + Check number box + Date (right) */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.18in" }}>

          {/* Left: issuer block */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
            {config.showCompanyLogo && company.logoUrl && (
              <img src={company.logoUrl} alt="" style={{ height: "38px", width: "38px", objectFit: "contain", marginTop: "2px" }} />
            )}
            <div>
              {config.showCompanyName && (
                <div style={{ fontSize: "14px", fontWeight: "700", letterSpacing: "0.2px", lineHeight: 1.2 }}>{company.name}</div>
              )}
              {company.dba && config.showCompanyName && (
                <div style={{ fontSize: "10px", color: "#444" }}>DBA: {company.dba}</div>
              )}
              {config.showCompanyAddress && company.address && (
                <div style={{ fontSize: "10px", color: "#333", marginTop: "2px" }}>{company.address}</div>
              )}
              {config.showCompanyAddress && (company.city || company.state || company.zip) && (
                <div style={{ fontSize: "10px", color: "#333" }}>
                  {[company.city, company.state].filter(Boolean).join(", ")}{company.zip ? " " + company.zip : ""}
                </div>
              )}
              {config.showCompanyAddress && company.phone && (
                <div style={{ fontSize: "10px", color: "#333" }}>{company.phone}</div>
              )}
            </div>
          </div>

          {/* Right: check number in bordered box + date + void notice + institution */}
          <div style={{ textAlign: "right", minWidth: "1.4in", marginTop: cal.dateTop ? `${cal.dateTop}in` : undefined, ...guideStyle("#dc2626") }}>
            {showGuides && <div style={{ fontSize: "7px", color: "#dc2626", fontWeight: "bold", textAlign: "left" }}>■ DATE FIELD</div>}
            {config.showCheckNumber && (
              <div style={{
                border: "1.5px solid #000",
                padding: "3px 10px",
                textAlign: "center",
                fontSize: "13px",
                fontWeight: "700",
                letterSpacing: "0.5px",
                marginBottom: "6px",
                minWidth: "1.4in",
                display: "inline-block",
                boxSizing: "border-box",
              }}>
                No. {checkNum}
              </div>
            )}
            <div style={{
              fontSize: "9px",
              fontWeight: "700",
              letterSpacing: "0.4px",
              color: "#333",
              marginBottom: "1px",
              textAlign: "right",
            }}>
              DATE
            </div>
            <div style={{
              fontSize: "11px",
              fontWeight: "600",
              borderBottom: "1.5px solid #000",
              paddingBottom: "2px",
              minWidth: "1.4in",
              display: "inline-block",
              textAlign: "center",
              boxSizing: "border-box",
            }}>
              {checkDate}
            </div>
            <div style={{ fontSize: "8px", color: "#777", fontStyle: "italic", marginTop: "3px" }}>VOID AFTER 90 DAYS</div>
            {institutionName && (
              <div style={{ fontSize: "8px", color: "#555", marginTop: "3px", fontWeight: "600", letterSpacing: "0.3px" }}>{institutionName}</div>
            )}
          </div>
        </div>

        {/* ROW 2: "PAY TO THE ORDER OF" + payee underline spanning full width + dollar-amount box */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: "8px", marginBottom: "6px" }}>
          <span style={{ fontSize: "9px", fontWeight: "700", whiteSpace: "nowrap", letterSpacing: "0.6px", paddingBottom: "4px", flexShrink: 0 }}>
            PAY TO THE ORDER OF
          </span>
          {/* Payee name on underline — stretches to fill space before amount box */}
          <div style={{
            flex: 1,
            borderBottom: "1.5px solid #000",
            paddingBottom: "4px",
            fontSize: "15px",
            fontWeight: "600",
            letterSpacing: "0.3px",
            minWidth: 0,
          }}>
            {worker.firstName} {worker.lastName}
          </div>
          {/* Dollar-amount box — double left border for security */}
          <div style={{
            border: "1.5px solid #000",
            borderLeft: "5px solid #000",
            padding: "4px 10px 4px 8px",
            fontSize: "16px",
            fontWeight: "700",
            minWidth: "1.4in",
            textAlign: "right",
            letterSpacing: "0.5px",
            whiteSpace: "nowrap",
            fontFamily: "'Courier New', Courier, monospace",
            flexShrink: 0,
            boxSizing: "border-box",
          }}>
            ${fmt(netPay)}
          </div>
        </div>

        {/* ROW 2b: Payee address (shown when showEmployeeAddress is on and worker has address) */}
        {config.showEmployeeAddress && (worker.address || worker.city) && (
          <div style={{ marginBottom: "6px", paddingLeft: "0.01in" }}>
            {worker.address && (
              <div style={{ fontSize: "10px", color: "#333", lineHeight: 1.35 }}>{worker.address}{worker.address2 ? ", " + worker.address2 : ""}</div>
            )}
            {(worker.city || worker.state || worker.zip) && (
              <div style={{ fontSize: "10px", color: "#333", lineHeight: 1.35 }}>
                {[worker.city, worker.state].filter(Boolean).join(", ")}{worker.zip ? " " + worker.zip : ""}
              </div>
            )}
          </div>
        )}

        {/* ROW 3: Written-out dollar amount + protective fill to right edge */}
        <div style={{ display: "flex", alignItems: "baseline", borderBottom: "1px solid #000", paddingBottom: "4px", marginBottom: "0.17in", marginTop: cal.amountWordsTop ? `${cal.amountWordsTop}in` : undefined, ...guideStyle("#2563eb") }}>
          {showGuides && <span style={{ fontSize: "7px", color: "#2563eb", fontWeight: "bold", flexShrink: 0, marginRight: "6px" }}>■ AMT WORDS</span>}
          <span style={{ fontSize: "11px", fontWeight: "600", flexShrink: 0, whiteSpace: "nowrap" }}>
            {numberToWords(netPay)} Dollars
          </span>
          {/* Protective underline fill — dots prevent alteration */}
          <span style={{
            flex: 1,
            display: "inline-block",
            marginLeft: "6px",
            overflow: "hidden",
            letterSpacing: "3px",
            color: "#aaa",
            fontSize: "10px",
            userSelect: "none",
            whiteSpace: "nowrap",
          }}>
            {"  \u2022\u00A0\u2022\u00A0\u2022\u00A0\u2022\u00A0\u2022\u00A0\u2022\u00A0\u2022\u00A0\u2022\u00A0\u2022\u00A0\u2022\u00A0\u2022\u00A0\u2022\u00A0\u2022\u00A0\u2022\u00A0\u2022\u00A0\u2022\u00A0\u2022\u00A0\u2022\u00A0\u2022\u00A0\u2022\u00A0\u2022\u00A0\u2022\u00A0\u2022\u00A0\u2022\u00A0\u2022\u00A0\u2022\u00A0\u2022\u00A0\u2022\u00A0\u2022\u00A0\u2022\u00A0\u2022\u00A0\u2022\u00A0\u2022"}
          </span>
        </div>

        {/* ROW 4: spacer — keeps memo/sig pinned to bottom of content area */}
        <div style={{ flex: 1 }} />

        {/* ROW 5: MEMO (left) + Authorized Signature line (right) */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>

          {/* Memo */}
          <div style={{ marginTop: cal.memoTop ? `${cal.memoTop}in` : undefined, ...guideStyle("#16a34a") }}>
            {showGuides && <div style={{ fontSize: "7px", color: "#16a34a", fontWeight: "bold" }}>■ MEMO</div>}
            <div style={{ fontSize: "8px", color: "#666", letterSpacing: "0.5px", marginBottom: "2px" }}>MEMO</div>
            <div style={{
              borderBottom: "1px solid #000",
              minWidth: "2.2in",
              paddingBottom: "2px",
              fontSize: "10px",
              color: "#333",
            }}>
              {memoText}
            </div>
          </div>

          {/* Signature */}
          <div style={{ marginTop: cal.signatureTop ? `${cal.signatureTop}in` : undefined, ...guideStyle("#d97706") }}>
            {showGuides && <div style={{ fontSize: "7px", color: "#d97706", fontWeight: "bold", textAlign: "center" }}>■ SIGNATURE</div>}
            {/* Blank signing space above the label */}
            <div style={{ borderBottom: "1.5px solid #000", width: "2.6in", height: "0.38in", margin: "0 auto" }} />
            <div style={{ fontSize: "8px", color: "#666", marginTop: "2px", letterSpacing: "0.4px", textAlign: "center", width: "2.6in", margin: "2px auto 0" }}>AUTHORIZED SIGNATURE</div>
          </div>
        </div>

        {/* ── BANK REFERENCE (non-MICR labeled section, inside content area) ── */}
        {(config as any).showBankReference && (routing || account) && (
          <div style={{
            borderTop: "0.5px dashed #bbb",
            marginTop: "6px",
            paddingTop: "4px",
            display: "flex",
            gap: "18px",
            alignItems: "center",
            paddingLeft: "0.05in",
          }}>
            <span style={{ fontSize: "7px", fontWeight: "700", color: "#999", letterSpacing: "0.5px", textTransform: "uppercase", flexShrink: 0 }}>
              Bank Reference
            </span>
            {routing && (
              <span style={{ fontSize: "7.5px", color: "#555", fontFamily: "'Courier New', monospace" }}>
                Routing: {routing}
              </span>
            )}
            {account && (
              <span style={{ fontSize: "7.5px", color: "#555", fontFamily: "'Courier New', monospace" }}>
                Account: {"·".repeat(Math.max(0, account.length - 4)) + account.slice(-4)}
              </span>
            )}
            {checkNum && (
              <span style={{ fontSize: "7.5px", color: "#555", fontFamily: "'Courier New', monospace" }}>
                Check #: {checkNum}
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── MICR BAND (bottom 0.625in, ANSI X9.27 clear zone) ── */}
      {/* Characters baseline at ~0.085in from check bottom per ANSI X9.100-160 */}
      <div style={{
        height: "0.625in",
        flexShrink: 0,
        display: "flex",
        alignItems: "flex-end",
        paddingBottom: "0.085in",
        paddingLeft: "0.25in",
        boxSizing: "border-box",
      }}>
        {config.showMicrLine && micrReady && (
          <MicrLine routing={routing} account={account} checkNum={checkNum} />
        )}
      </div>
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
              {config.showPayPeriod && (
                <>
                  <div>Pay Period Start: {run.periodStart.slice(0, 10)}</div>
                  <div>Pay Period End: {run.periodEnd.slice(0, 10)}</div>
                </>
              )}
              <div style={{ fontWeight: "bold" }}>Pay Date: {run.payDate
                ? new Date(run.payDate + "T00:00:00").toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" })
                : "—"}</div>
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
    .filter(a => a.workerId === item.workerId && a.status === "active" && a.amendmentType === "deduction")
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
          <div><span style={{ fontWeight: "bold" }}>Pay Period Start:</span> {fmtDate(run.periodStart)}</div>
          <div><span style={{ fontWeight: "bold" }}>Pay Period End:</span> {fmtDate(run.periodEnd)}</div>
          <div><span style={{ fontWeight: "bold" }}>Pay Date:</span> {run.payDate ? fmtDate(run.payDate) : '—'}</div>
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
    .filter(a => a.workerId === item.workerId && a.status === "active" && a.amendmentType === "deduction")
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
          <div>
            <div><strong>Pay Period Start:</strong> {run.periodStart ? new Date(run.periodStart + "T00:00:00").toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" }) : "—"}</div>
            <div><strong>Pay Period End:</strong> {run.periodEnd ? new Date(run.periodEnd + "T00:00:00").toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" }) : "—"}</div>
          </div>
          {config.showCheckNumber && <div style={{ alignSelf: "center" }}><strong>Check #:</strong> {item.checkNumber || "—"}</div>}
          <div style={{ alignSelf: "center" }}><strong>Pay Date:</strong> {run.payDate
            ? new Date(run.payDate + "T00:00:00").toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" })
            : "—"}</div>
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
  calibration?: CheckCalibration;
  showGuides?: boolean;
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
    .filter(a => a.workerId === item.workerId && a.status === "active" && a.amendmentType === "deduction")
    .map(a => Number(a.amount || 0))
    .filter(a => a > 0);
  const totalDed = [...taxLines, ...amendLines].reduce((s, v) => s + v, 0);
  return grossPay - totalDed;
}

function StandardCheck({ item, worker, company, run, deductions, config, payStubAccounts, accrualAccounts, accrualBalances, amendments = [], remittanceSources = [], calibration, showGuides = false }: CheckProps) {
  const computedNetPay = computeCheckNetPay(item, worker, deductions, amendments);
  return (
    <div className="check-page" style={{ width: "8.5in", height: "11in", pageBreakAfter: "always", fontFamily: "'Arial', 'Helvetica Neue', Helvetica, sans-serif" }}>
      {/* Top third: the actual check */}
      <div style={{ height: "3.667in" }}>
        <CheckPortion item={item} worker={worker} company={company} run={run} config={config} overrideNetPay={computedNetPay} remittanceSources={remittanceSources} calibration={calibration} showGuides={showGuides} />
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

function VoucherCheck({ item, worker, company, run, deductions, config, payStubAccounts, accrualAccounts, accrualBalances, amendments = [], remittanceSources = [], calibration, showGuides = false }: CheckProps) {
  const computedNetPay = computeCheckNetPay(item, worker, deductions, amendments);
  return (
    <div className="check-page" style={{ width: "8.5in", height: "11in", pageBreakAfter: "always", fontFamily: "'Arial', 'Helvetica Neue', Helvetica, sans-serif" }}>
      <div style={{ height: "3.333in" }}>
        <StubPortion item={item} worker={worker} company={company} run={run} deductions={deductions} config={config} payStubAccounts={payStubAccounts} accrualAccounts={accrualAccounts} accrualBalances={accrualBalances} amendments={amendments} />
      </div>
      <div style={{ height: "3.667in" }}>
        <CheckPortion item={item} worker={worker} company={company} run={run} config={config} overrideNetPay={computedNetPay} remittanceSources={remittanceSources} calibration={calibration} showGuides={showGuides} />
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

function PayrollPacketSummaryPage({
  run, items, workers, company,
}: {
  run: PayrollRun;
  items: PayrollItem[];
  workers: Worker[];
  company: Company;
}) {
  const fmtDate = (d: string | null | undefined) => {
    if (!d) return "—";
    const parts = String(d).split("-");
    return parts.length === 3 ? `${parts[1]}/${parts[2]}/${parts[0]}` : String(d);
  };

  const payDate = run.payDate ? fmtDate(run.payDate) : "—";

  const totalGross = items.reduce((s, i) => s + Number(i.grossPay || 0), 0);
  const totalDeductions = items.reduce((s, i) => s + Number(i.deductions || 0), 0);
  const totalNet = items.reduce((s, i) => s + Number(i.netPay || 0), 0);
  const totalRegHrs = items.reduce((s, i) => s + Number(i.regularHours || 0), 0);
  const totalOtHrs = items.reduce((s, i) => s + Number(i.overtimeHours || 0), 0);
  const totalDtHrs = items.reduce((s, i) => s + Number(i.doubleTimeHours || 0), 0);

  const checkItems = items.filter(i => !i.paymentMethod || i.paymentMethod === "check");
  const achItems = items.filter(i => i.paymentMethod === "direct_deposit");
  const cashItems = items.filter(i => i.paymentMethod === "cash");
  const tradeItems = items.filter(i => i.paymentMethod === "trade");
  const otherItems = items.filter(i => i.paymentMethod && !["check", "direct_deposit", "cash", "trade"].includes(i.paymentMethod));

  const achTotal = achItems.reduce((s, i) => s + Number(i.netPay || 0), 0);
  const checkTotal = checkItems.reduce((s, i) => s + Number(i.netPay || 0), 0);
  const cashTotal = cashItems.reduce((s, i) => s + Number(i.netPay || 0), 0);
  const tradeTotal = tradeItems.reduce((s, i) => s + Number(i.netPay || 0), 0);
  const otherTotal = otherItems.reduce((s, i) => s + Number(i.netPay || 0), 0);
  const fundingRequired = totalNet;

  const getWorkerName = (id: string) => {
    const w = workers.find(w => w.id === id);
    return w ? `${w.firstName} ${w.lastName}` : id;
  };

  const methodLabel = (m: string | null | undefined) => {
    if (!m || m === "check") return "Check";
    if (m === "direct_deposit") return "Direct Deposit / ACH";
    if (m === "cash") return "Cash";
    return m;
  };

  return (
    <div className="packet-page" style={{
      width: "8.5in", minHeight: "11in", padding: "0.5in 0.6in", boxSizing: "border-box",
      fontFamily: "'Arial', 'Helvetica Neue', Helvetica, sans-serif", fontSize: "10px",
      background: "white", pageBreakAfter: "always",
    }}>
      {/* Header */}
      <div style={{ borderBottom: "2px solid #000", paddingBottom: "8px", marginBottom: "16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: "18px", fontWeight: "bold" }}>PAYROLL PACKET</div>
            <div style={{ fontSize: "11px", color: "#444", marginTop: "2px" }}>{company.name}{company.ein ? ` — EIN: ${company.ein}` : ""}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "11px", fontWeight: "bold" }}>Pay Date: {payDate}</div>
            <div style={{ fontSize: "9px", color: "#555" }}>Period: {fmtDate(run.periodStart)} — {fmtDate(run.periodEnd)}</div>
            <div style={{ fontSize: "9px", color: "#555" }}>Status: {run.status?.toUpperCase()}</div>
          </div>
        </div>
      </div>

      {/* Payroll Summary */}
      <div style={{ marginBottom: "16px" }}>
        <div style={{ fontSize: "13px", fontWeight: "bold", borderBottom: "1px solid #555", paddingBottom: "3px", marginBottom: "8px" }}>
          PAYROLL SUMMARY
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px" }}>
          {[
            { label: "Total Workers", value: String(items.length) },
            { label: "Total Regular Hrs", value: totalRegHrs.toFixed(2) },
            { label: "Total Overtime Hrs", value: totalOtHrs.toFixed(2) },
            { label: "Total Double Time Hrs", value: totalDtHrs.toFixed(2) },
            { label: "Total Gross Pay", value: `$${fmt(totalGross)}` },
            { label: "Total Deductions", value: `$${fmt(totalDeductions)}` },
            { label: "Total Net Pay", value: `$${fmt(totalNet)}` },
            { label: "Funding Required", value: `$${fmt(fundingRequired)}` },
          ].map(({ label, value }) => (
            <div key={label} style={{ border: "1px solid #ddd", padding: "6px 8px", borderRadius: "3px" }}>
              <div style={{ fontSize: "8px", color: "#666", marginBottom: "2px" }}>{label}</div>
              <div style={{ fontSize: "12px", fontWeight: "bold" }}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Payment Method Totals */}
      <div style={{ marginBottom: "16px" }}>
        <div style={{ fontSize: "13px", fontWeight: "bold", borderBottom: "1px solid #555", paddingBottom: "3px", marginBottom: "8px" }}>
          PAYMENT METHOD TOTALS
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "10px" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #000" }}>
              <th style={{ textAlign: "left", padding: "4px 6px", fontWeight: "bold" }}>Method</th>
              <th style={{ textAlign: "right", padding: "4px 6px", fontWeight: "bold" }}>Count</th>
              <th style={{ textAlign: "right", padding: "4px 6px", fontWeight: "bold" }}>Total Net</th>
            </tr>
          </thead>
          <tbody>
            {checkItems.length > 0 && (
              <tr style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "3px 6px" }}>Check</td>
                <td style={{ textAlign: "right", padding: "3px 6px" }}>{checkItems.length}</td>
                <td style={{ textAlign: "right", padding: "3px 6px" }}>${fmt(checkTotal)}</td>
              </tr>
            )}
            {achItems.length > 0 && (
              <tr style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "3px 6px" }}>Direct Deposit / ACH</td>
                <td style={{ textAlign: "right", padding: "3px 6px" }}>{achItems.length}</td>
                <td style={{ textAlign: "right", padding: "3px 6px" }}>${fmt(achTotal)}</td>
              </tr>
            )}
            {cashItems.length > 0 && (
              <tr style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "3px 6px" }}>Cash</td>
                <td style={{ textAlign: "right", padding: "3px 6px" }}>{cashItems.length}</td>
                <td style={{ textAlign: "right", padding: "3px 6px" }}>${fmt(cashTotal)}</td>
              </tr>
            )}
            {tradeItems.length > 0 && (
              <tr style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "3px 6px" }}>Trade / Non-Cash Compensation</td>
                <td style={{ textAlign: "right", padding: "3px 6px" }}>{tradeItems.length}</td>
                <td style={{ textAlign: "right", padding: "3px 6px" }}>${fmt(tradeTotal)}</td>
              </tr>
            )}
            {otherItems.length > 0 && (
              <tr style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "3px 6px" }}>Other</td>
                <td style={{ textAlign: "right", padding: "3px 6px" }}>{otherItems.length}</td>
                <td style={{ textAlign: "right", padding: "3px 6px" }}>${fmt(otherTotal)}</td>
              </tr>
            )}
            <tr style={{ borderTop: "2px solid #000", fontWeight: "bold" }}>
              <td style={{ padding: "4px 6px" }}>TOTAL</td>
              <td style={{ textAlign: "right", padding: "4px 6px" }}>{items.length}</td>
              <td style={{ textAlign: "right", padding: "4px 6px" }}>${fmt(totalNet)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Payroll Transaction Run List */}
      <div style={{ marginBottom: "16px" }}>
        <div style={{ fontSize: "13px", fontWeight: "bold", borderBottom: "1px solid #555", paddingBottom: "3px", marginBottom: "8px" }}>
          PAYROLL TRANSACTION RUN — ALL WORKERS
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "9px" }}>
          <thead>
            <tr style={{ borderBottom: "1.5px solid #000", background: "#f5f5f5" }}>
              <th style={{ textAlign: "left", padding: "3px 4px", fontWeight: "bold" }}>Worker</th>
              <th style={{ textAlign: "left", padding: "3px 4px", fontWeight: "bold" }}>Type</th>
              <th style={{ textAlign: "right", padding: "3px 4px", fontWeight: "bold" }}>Reg Hrs</th>
              <th style={{ textAlign: "right", padding: "3px 4px", fontWeight: "bold" }}>OT Hrs</th>
              <th style={{ textAlign: "right", padding: "3px 4px", fontWeight: "bold" }}>Gross</th>
              <th style={{ textAlign: "right", padding: "3px 4px", fontWeight: "bold" }}>Deductions</th>
              <th style={{ textAlign: "right", padding: "3px 4px", fontWeight: "bold" }}>Net Pay</th>
              <th style={{ textAlign: "center", padding: "3px 4px", fontWeight: "bold" }}>Method</th>
              <th style={{ textAlign: "center", padding: "3px 4px", fontWeight: "bold" }}>Check #</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={item.id} style={{ borderBottom: "1px solid #eee", background: idx % 2 === 0 ? "white" : "#fafafa" }}>
                <td style={{ padding: "2px 4px" }}>{getWorkerName(item.workerId)}</td>
                <td style={{ padding: "2px 4px" }}>{item.payType || "hourly"}</td>
                <td style={{ textAlign: "right", padding: "2px 4px" }}>{Number(item.regularHours || 0).toFixed(2)}</td>
                <td style={{ textAlign: "right", padding: "2px 4px" }}>{Number(item.overtimeHours || 0).toFixed(2)}</td>
                <td style={{ textAlign: "right", padding: "2px 4px" }}>${fmt(item.grossPay)}</td>
                <td style={{ textAlign: "right", padding: "2px 4px" }}>${fmt(item.deductions)}</td>
                <td style={{ textAlign: "right", padding: "2px 4px", fontWeight: "bold" }}>${fmt(item.netPay)}</td>
                <td style={{ textAlign: "center", padding: "2px 4px" }}>{methodLabel(item.paymentMethod)}</td>
                <td style={{ textAlign: "center", padding: "2px 4px", fontFamily: "monospace" }}>{item.checkNumber || "—"}</td>
              </tr>
            ))}
            <tr style={{ borderTop: "2px solid #000", fontWeight: "bold", background: "#f5f5f5" }}>
              <td colSpan={4} style={{ padding: "3px 4px" }}>TOTALS</td>
              <td style={{ textAlign: "right", padding: "3px 4px" }}>${fmt(totalGross)}</td>
              <td style={{ textAlign: "right", padding: "3px 4px" }}>${fmt(totalDeductions)}</td>
              <td style={{ textAlign: "right", padding: "3px 4px" }}>${fmt(totalNet)}</td>
              <td colSpan={2}></td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ACH / Direct Deposit Batch section */}
      {achItems.length > 0 && (
        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontSize: "13px", fontWeight: "bold", borderBottom: "1px solid #555", paddingBottom: "3px", marginBottom: "6px" }}>
            ACH / DIRECT DEPOSIT BATCH
          </div>
          <div style={{ fontSize: "10px" }}>
            <div style={{ display: "flex", gap: "24px", marginBottom: "4px" }}>
              <div><span style={{ color: "#666" }}>Employees via ACH:</span> <strong>{achItems.length}</strong></div>
              <div><span style={{ color: "#666" }}>ACH Total:</span> <strong>${fmt(achTotal)}</strong></div>
              <div><span style={{ color: "#666" }}>Effective Date:</span> <strong>{payDate !== "—" ? payDate : "See Pay Date"}</strong></div>
              <div><span style={{ color: "#666" }}>Batch Status:</span> <strong>{run.status === "paid" ? "Settled" : run.status === "processed" ? "Approved — Pending Settlement" : "Pending"}</strong></div>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{ borderTop: "1px solid #ccc", paddingTop: "8px", marginTop: "auto", fontSize: "8px", color: "#999", textAlign: "center" }}>
        Payroll Packet — {company.name} — Printed {new Date().toLocaleDateString("en-US")} — CONFIDENTIAL
      </div>
    </div>
  );
}

// ── Check Print Validation ───────────────────────────────────────────────────

type ValidationIssue = {
  severity: "blocking" | "warning";
  field: string;
  message: string;
  fixPath?: string;
  fixLabel?: string;
};

function buildMicr(routing: string, account: string, checkNum: string): { valid: boolean; error?: string; field?: string } {
  const r = routing.replace(/\D/g, "");
  const a = account.replace(/\D/g, "");
  const c = checkNum.replace(/\D/g, "");
  if (!r || r.length !== 9) {
    return { valid: false, error: `Routing number must be exactly 9 digits (got ${r.length || 0})`, field: "routing" };
  }
  const digits = r.split("").map(Number);
  const checksum = (3*digits[0] + 7*digits[1] + digits[2] + 3*digits[3] + 7*digits[4] + digits[5] + 3*digits[6] + 7*digits[7] + digits[8]) % 10;
  if (checksum !== 0) {
    return { valid: false, error: `Routing number "${r}" failed ABA checksum — verify it is correct`, field: "routing" };
  }
  if (!a || a.length < 4) {
    return { valid: false, error: `Account number is ${a ? `too short (${a.length} digits, need ≥4)` : "missing"}`, field: "account" };
  }
  if (!c) {
    return { valid: false, error: "Check number is missing", field: "checkNum" };
  }
  return { valid: true };
}

function validateCheckReadiness(
  item: PayrollItem,
  worker: Worker | undefined,
  remittanceSources: RemittanceSource[],
  companyId: string,
  micrFontLoaded: boolean | null,
  payDate?: string | null,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!payDate) {
    issues.push({ severity: "blocking", field: "payDate", message: "Pay date is not set on this payroll run — set a pay date before printing checks", fixPath: "/app/payroll?tab=process", fixLabel: "Open Payroll" });
  }
  if (!worker) {
    issues.push({ severity: "blocking", field: "worker", message: "Worker record not found for this payroll item", fixPath: "/app/employees", fixLabel: "Open Employees" });
    return issues;
  }
  if (!worker.firstName && !worker.lastName) {
    issues.push({ severity: "blocking", field: "payee", message: "Worker has no name (required for payee line)", fixPath: `/app/employees`, fixLabel: "Edit Worker" });
  }
  const netPay = Number(item.netPay || 0);
  if (netPay <= 0) {
    issues.push({ severity: "blocking", field: "amount", message: `Net pay is $${netPay.toFixed(2)} — cannot print a check for zero or negative amount`, fixPath: "/app/payroll?tab=process", fixLabel: "Open Payroll" });
  }
  if (item.paymentMethod && item.paymentMethod !== "check") {
    issues.push({ severity: "blocking", field: "paymentMethod", message: `Payment method is "${item.paymentMethod}" — this employee is not set up for paper checks`, fixPath: "/app/payroll?tab=process", fixLabel: "Open Payroll" });
  }
  if (!item.checkNumber) {
    issues.push({ severity: "blocking", field: "checkNumber", message: "No check number assigned — process the payroll run first to assign check numbers", fixPath: "/app/payroll?tab=process", fixLabel: "Open Payroll" });
  }
  // Duplicate check number guard (within the current run's items is handled at caller level)
  const checkNumDigits = String(item.checkNumber || "").replace(/\D/g, "");
  if (checkNumDigits && (checkNumDigits === "0000" || checkNumDigits === "0")) {
    issues.push({ severity: "blocking", field: "checkNumber", message: "Check number is 0 — assign a valid starting check number in Remittance Sources", fixPath: "/app/settings", fixLabel: "Open Settings" });
  }
  const remittanceSource = remittanceSources.find(s => s.companyId === companyId && s.status === "enabled") || remittanceSources.find(s => s.companyId === companyId);
  if (!remittanceSource) {
    issues.push({ severity: "blocking", field: "remittanceSource", message: "No remittance source (bank account) configured for this company — add one in Settings", fixPath: "/app/settings", fixLabel: "Open Settings" });
    return issues;
  }
  const routing = remittanceSource.routingNumber || "";
  const account = remittanceSource.accountNumber || "";
  const checkNum = String(item.checkNumber || "");
  const micrResult = buildMicr(routing, account, checkNum);
  if (!micrResult.valid && micrResult.field === "routing") {
    issues.push({ severity: "blocking", field: "routing", message: micrResult.error!, fixPath: "/app/settings", fixLabel: "Open Remittance Sources" });
  }
  if (!micrResult.valid && micrResult.field === "account") {
    issues.push({ severity: "blocking", field: "account", message: micrResult.error!, fixPath: "/app/settings", fixLabel: "Open Remittance Sources" });
  }
  if (!micrResult.valid && micrResult.field === "checkNum") {
    issues.push({ severity: "blocking", field: "checkNum", message: micrResult.error!, fixPath: "/app/payroll?tab=process", fixLabel: "Open Payroll" });
  }
  // MICR font loading is detected separately (micrFontLoaded state in PrintCheckPage).
  // A non-blocking warning is shown in the UI if the font fails to load.
  // The micrFontLoaded param is kept for future per-check validation if needed.
  void micrFontLoaded;
  return issues;
}

function CheckValidationErrorCard({ item, worker, issues }: { item: PayrollItem; worker?: Worker; issues: ValidationIssue[] }) {
  const netPay = Number(item.netPay || 0);
  return (
    <div className="check-page print-hide" style={{ width: "8.5in", padding: "0.5in", boxSizing: "border-box", fontFamily: "Arial, sans-serif" }}>
      <div style={{ border: "3px solid #dc2626", borderRadius: "8px", padding: "24px", background: "#fef2f2", minHeight: "3.667in", boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
          <AlertTriangle style={{ width: 24, height: 24, color: "#dc2626", flexShrink: 0 }} />
          <span style={{ fontWeight: "700", fontSize: "18px", color: "#dc2626" }}>Check Print Blocked</span>
        </div>
        <p style={{ fontSize: "14px", color: "#7f1d1d", marginBottom: "16px" }}>
          <strong>{worker ? `${worker.firstName} ${worker.lastName}` : "(unknown worker)"}</strong>
          {" "}— Check #{item.checkNumber || "(unassigned)"} — ${netPay.toFixed(2)}
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {issues.map((issue, i) => (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: "10px", background: "white", border: "1px solid #fca5a5", borderRadius: "6px", padding: "12px" }}>
              <div style={{ width: 18, height: 18, background: "#dc2626", borderRadius: "50%", flexShrink: 0, marginTop: "2px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ color: "white", fontSize: "11px", fontWeight: "bold" }}>✕</span>
              </div>
              <div>
                <div style={{ fontSize: "13px", fontWeight: "600", color: "#991b1b" }}>{issue.message}</div>
                {issue.fixPath && issue.fixLabel && (
                  <a href={issue.fixPath} style={{ fontSize: "12px", color: "#2563eb", textDecoration: "underline" }}>{issue.fixLabel} →</a>
                )}
              </div>
            </div>
          ))}
        </div>
        <p style={{ marginTop: "20px", fontSize: "11px", color: "#6b7280" }}>
          This card will not appear on any printed document. Resolve the issues above, then return to this page to print.
        </p>
      </div>
    </div>
  );
}

function CalibrationPanel({
  remittanceSourceId,
  calibration,
  onChange,
  onSave,
  onTestPrint,
  saving,
}: {
  remittanceSourceId: string | undefined;
  calibration: CheckCalibration;
  onChange: (c: CheckCalibration) => void;
  onSave: () => void;
  onTestPrint: () => void;
  saving: boolean;
}) {
  const [open, setOpen] = useState(false);

  const Field = ({
    label, field, color, description,
  }: { label: string; field: keyof CheckCalibration; color: string; description?: string }) => (
    <div className="flex flex-col gap-1">
      <Label className="text-xs font-semibold" style={{ color }}>
        ■ {label}
      </Label>
      {description && <p className="text-xs text-muted-foreground leading-tight">{description}</p>}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-6 w-6 p-0 text-xs"
          onClick={() => onChange({ ...calibration, [field]: Math.round((calibration[field] - 0.01) * 1000) / 1000 })}
        >−</Button>
        <Input
          type="number"
          step="0.01"
          min="-1"
          max="1"
          value={calibration[field]}
          onChange={e => onChange({ ...calibration, [field]: parseFloat(e.target.value) || 0 })}
          className="w-20 text-xs h-7 text-center"
          data-testid={`input-cal-${field}`}
        />
        <Button
          variant="outline"
          size="sm"
          className="h-6 w-6 p-0 text-xs"
          onClick={() => onChange({ ...calibration, [field]: Math.round((calibration[field] + 0.01) * 1000) / 1000 })}
        >+</Button>
        <span className="text-xs text-muted-foreground">in</span>
        {calibration[field] !== 0 && (
          <button
            className="text-xs text-blue-600 hover:text-blue-800 underline"
            onClick={() => onChange({ ...calibration, [field]: 0 })}
          >reset</button>
        )}
      </div>
    </div>
  );

  if (!remittanceSourceId) return null;

  return (
    <div className="mx-4 mb-3 rounded-md border border-indigo-200 bg-indigo-50 dark:bg-indigo-950/20 dark:border-indigo-700 print-hide" data-testid="panel-calibration">
      <button
        className="w-full flex items-center justify-between p-3 text-sm font-medium text-indigo-800 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 rounded-md"
        onClick={() => setOpen(v => !v)}
        data-testid="button-calibration-toggle"
      >
        <span className="flex items-center gap-2">
          <Settings2 className="h-4 w-4" />
          Check Calibration — Adjust field positions for your check stock
        </span>
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>

      {open && (
        <div className="p-4 border-t border-indigo-200 dark:border-indigo-700 space-y-5">
          <p className="text-xs text-indigo-700 dark:text-indigo-300">
            Enter offset values in inches (positive = down/right, negative = up/left). Changes apply live to the check preview.
            Use the <strong>■ colored borders</strong> in Test Print mode to identify each field.
            Save calibration to persist it for this bank account.
          </p>

          <div className="grid grid-cols-2 gap-x-8 gap-y-4">
            <Field label="Global: vertical shift" field="globalTop" color="#7c3aed"
              description="Moves entire check up/down" />
            <Field label="Global: horizontal shift" field="globalLeft" color="#7c3aed"
              description="Moves entire check left/right" />
            <Field label="Date field" field="dateTop" color="#dc2626"
              description="Check number and date block (top-right)" />
            <Field label="Amount in words" field="amountWordsTop" color="#2563eb"
              description="Written-out dollar amount line" />
            <Field label="Memo line" field="memoTop" color="#16a34a"
              description="Pay period memo (bottom-left)" />
            <Field label="Signature line" field="signatureTop" color="#d97706"
              description="Authorized signature line (bottom-right)" />
          </div>

          <div className="flex flex-wrap gap-2 pt-2 border-t border-indigo-200 dark:border-indigo-700">
            <Button
              size="sm"
              onClick={onSave}
              disabled={saving || !remittanceSourceId}
              data-testid="button-calibration-save"
            >
              <Save className="h-3.5 w-3.5 mr-1.5" />
              {saving ? "Saving…" : "Save Calibration"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onTestPrint}
              data-testid="button-calibration-test-print"
            >
              <Crosshair className="h-3.5 w-3.5 mr-1.5" />
              Test Print (with guides)
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onChange({ ...DEFAULT_CALIBRATION })}
              data-testid="button-calibration-reset"
            >
              <RefreshCcw className="h-3.5 w-3.5 mr-1.5" />
              Reset All
            </Button>
          </div>

          <div className="text-xs text-indigo-600 dark:text-indigo-400 space-y-1">
            <p><strong>■ Purple</strong> = whole check container &nbsp;
               <strong style={{ color: "#dc2626" }}>■ Red</strong> = date/check# block &nbsp;
               <strong style={{ color: "#2563eb" }}>■ Blue</strong> = amount in words &nbsp;
               <strong style={{ color: "#16a34a" }}>■ Green</strong> = memo &nbsp;
               <strong style={{ color: "#d97706" }}>■ Orange</strong> = signature</p>
          </div>
        </div>
      )}
    </div>
  );
}

function CheckDiagnosticsPanel({
  checkItemsWithValidation, micrFontLoaded, templateName, fundingAccountId,
}: {
  checkItemsWithValidation: Array<{ item: PayrollItem; worker?: Worker; issues: ValidationIssue[]; remittanceSource?: RemittanceSource }>;
  micrFontLoaded: boolean | null;
  templateName: string;
  fundingAccountId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const allValid = checkItemsWithValidation.every(c => c.issues.length === 0);
  return (
    <div className="mx-4 mb-3 rounded-md border border-slate-200 bg-slate-50 dark:bg-slate-950/20 dark:border-slate-700 print-hide" data-testid="panel-diagnostics">
      <button
        className="w-full flex items-center justify-between p-3 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md"
        onClick={() => setOpen(v => !v)}
        data-testid="button-diagnostics-toggle"
      >
        <span className="flex items-center gap-2">
          {allValid
            ? <CheckCircle2 className="h-4 w-4 text-green-600" />
            : <AlertTriangle className="h-4 w-4 text-red-500" />}
          Print Diagnostics — {allValid ? "All checks ready" : `${checkItemsWithValidation.filter(c => c.issues.length > 0).length} check(s) have issues`}
        </span>
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>
      {open && (
        <div className="p-3 border-t border-slate-200 dark:border-slate-700 space-y-2 text-xs">
          <div className="grid grid-cols-2 gap-2 text-slate-600 dark:text-slate-400 mb-3">
            <div><span className="font-medium">Render engine:</span> browser-print (CSS @media print)</div>
            <div><span className="font-medium">Template:</span> {templateName}</div>
            <div><span className="font-medium">MICR band:</span> <span className={micrFontLoaded === true ? "text-green-600" : micrFontLoaded === false ? "text-red-600 font-semibold" : "text-yellow-600"}>{micrFontLoaded === true ? "✓ MICRNumeric font loaded — E-13B active" : micrFontLoaded === false ? "⚠ Font not loaded — MICR will not render" : "Loading font…"}</span></div>
            <div><span className="font-medium">Funding account:</span> {fundingAccountId || "(none linked)"}</div>
          </div>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100 dark:bg-slate-800">
                <th className="text-left p-2 border border-slate-200 dark:border-slate-700">Payee</th>
                <th className="text-left p-2 border border-slate-200 dark:border-slate-700">Check #</th>
                <th className="text-right p-2 border border-slate-200 dark:border-slate-700">Amount</th>
                <th className="text-left p-2 border border-slate-200 dark:border-slate-700">Routing</th>
                <th className="text-left p-2 border border-slate-200 dark:border-slate-700">Account</th>
                <th className="text-center p-2 border border-slate-200 dark:border-slate-700">MICR</th>
                <th className="text-left p-2 border border-slate-200 dark:border-slate-700">Status</th>
              </tr>
            </thead>
            <tbody>
              {checkItemsWithValidation.map(({ item, worker, issues, remittanceSource }) => {
                const routing = (remittanceSource?.routingNumber || "").replace(/\D/g, "");
                const account = (remittanceSource?.accountNumber || "").replace(/\D/g, "");
                const micrCheck = buildMicr(routing, account, String(item.checkNumber || ""));
                const blocked = issues.some(i => i.severity === "blocking");
                return (
                  <tr key={item.id} className={blocked ? "bg-red-50 dark:bg-red-950/20" : "bg-white dark:bg-transparent"}>
                    <td className="p-2 border border-slate-200 dark:border-slate-700">
                      {worker ? `${worker.firstName} ${worker.lastName}` : item.workerId}
                    </td>
                    <td className="p-2 border border-slate-200 dark:border-slate-700 font-mono">{item.checkNumber || "—"}</td>
                    <td className="p-2 border border-slate-200 dark:border-slate-700 text-right">${Number(item.netPay || 0).toFixed(2)}</td>
                    <td className="p-2 border border-slate-200 dark:border-slate-700 font-mono">
                      {routing ? `•••${routing.slice(-4)} (${routing.length} digits)` : <span className="text-red-600">missing</span>}
                    </td>
                    <td className="p-2 border border-slate-200 dark:border-slate-700 font-mono">
                      {account ? `•••${account.slice(-4)} (${account.length} digits)` : <span className="text-red-600">missing</span>}
                    </td>
                    <td className="p-2 border border-slate-200 dark:border-slate-700 text-center">
                      {micrCheck.valid
                        ? <span className="text-green-600">✓</span>
                        : <span className="text-red-600" title={micrCheck.error}>✕</span>}
                    </td>
                    <td className="p-2 border border-slate-200 dark:border-slate-700">
                      {blocked
                        ? <span className="text-red-600 font-medium">Blocked</span>
                        : <span className="text-green-600 font-medium">Ready</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function PrintCheckPage() {
  const { runId } = useParams<{ runId: string }>();
  const search = useSearch();
  const searchParams = new URLSearchParams(search);
  const isPacketMode = searchParams.get("packet") === "1";
  const workerFilter = searchParams.get("worker") || null;
  const [fontReady, setFontReady] = useState(false);
  const [micrFontLoaded, setMicrFontLoaded] = useState<boolean | null>(null);
  const [calibration, setCalibration] = useState<CheckCalibration>({ ...DEFAULT_CALIBRATION });
  const [calibrationTestMode, setCalibrationTestMode] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    let cancelled = false;
    document.fonts.ready.then(async () => {
      if (!cancelled) setFontReady(true);
      try {
        const loaded = await document.fonts.load("13pt MICRNumeric");
        if (!cancelled) setMicrFontLoaded(loaded.length > 0);
      } catch {
        if (!cancelled) setMicrFontLoaded(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  async function handlePrint(
    checkItemsWithValidation: Array<{ item: PayrollItem; worker?: Worker; issues: ValidationIssue[]; remittanceSource?: RemittanceSource }>,
    runId: string,
    companyId: string | undefined,
    activeTemplateId: string | undefined,
    totalAmount: number,
  ) {
    const hasBlocking = checkItemsWithValidation.some(c => c.issues.some(i => i.severity === "blocking"));
    const micrOverall = hasBlocking ? "blocked" : micrFontLoaded === false ? "font_missing" : micrFontLoaded === null ? "pending" : "ok";
    const validationErrors = checkItemsWithValidation
      .filter(c => c.issues.length > 0)
      .map(c => ({
        workerId: c.item.workerId,
        workerName: c.worker ? `${c.worker.firstName} ${c.worker.lastName}` : c.item.workerId,
        errors: c.issues.map(i => i.message),
      }));
    // Fire-and-forget audit log
    fetch("/api/check-print-audit", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        payrollRunId: runId,
        companyId: companyId || null,
        checkCount: checkItemsWithValidation.filter(c => c.issues.length === 0).length,
        totalAmount,
        micrValidation: micrOverall,
        validationErrors,
        printBlocked: hasBlocking,
        templateId: activeTemplateId || null,
      }),
    }).catch(() => {});
    if (hasBlocking) return;
    await document.fonts.ready;
    window.print();
  }

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

  // Active remittance source for calibration
  const activeRemittanceSource = run
    ? (remittanceSources.find(s => s.companyId === run.companyId && s.status === "enabled") || remittanceSources.find(s => s.companyId === run.companyId))
    : undefined;

  // Load calibration from remittance source when it first becomes available
  useEffect(() => {
    if (!activeRemittanceSource) return;
    const stored = activeRemittanceSource.calibrationConfig as any;
    if (stored && typeof stored === "object") {
      setCalibration({
        globalTop: Number(stored.globalTop ?? activeRemittanceSource.verticalAlignment ?? 0),
        globalLeft: Number(stored.globalLeft ?? activeRemittanceSource.horizontalAlignment ?? 0),
        dateTop: Number(stored.dateTop ?? 0),
        amountWordsTop: Number(stored.amountWordsTop ?? 0),
        memoTop: Number(stored.memoTop ?? 0),
        signatureTop: Number(stored.signatureTop ?? 0),
      });
    } else {
      // Fall back to legacy alignment fields
      setCalibration({
        ...DEFAULT_CALIBRATION,
        globalTop: Number(activeRemittanceSource.verticalAlignment ?? 0),
        globalLeft: Number(activeRemittanceSource.horizontalAlignment ?? 0),
      });
    }
  }, [activeRemittanceSource?.id]);

  // Save calibration mutation
  const saveCalibrationMutation = useMutation({
    mutationFn: async () => {
      if (!activeRemittanceSource?.id) throw new Error("No remittance source");
      return apiRequest("PATCH", `/api/remittance-sources/${activeRemittanceSource.id}`, {
        calibrationConfig: calibration,
        verticalAlignment: String(calibration.globalTop),
        horizontalAlignment: String(calibration.globalLeft),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/remittance-sources"] });
      toast({ title: "Calibration saved", description: "Check alignment settings saved for this bank account." });
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  // Test print — turns on guides then prints, then turns off guides
  async function handleCalibrationTestPrint() {
    setCalibrationTestMode(true);
    await new Promise(r => setTimeout(r, 300)); // allow re-render
    fetch("/api/check-print-audit", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        payrollRunId: runId,
        companyId: company?.id || null,
        checkCount: 0,
        totalAmount: 0,
        micrValidation: "calibration_test",
        validationErrors: [],
        printBlocked: false,
        templateId: null,
        eventType: "calibration_test",
      }),
    }).catch(() => {});
    await document.fonts.ready;
    window.print();
    setTimeout(() => setCalibrationTestMode(false), 500);
  }

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
        <Link href="/app/payroll?tab=process">
          <Button variant="outline" data-testid="button-back-payroll">
            <ArrowLeft className="mr-2 h-4 w-4" />Back to Payroll
          </Button>
        </Link>
      </div>
    );
  }

  const isLocked = run.status === "processed" || run.status === "paid";
  const companyDeductions = taxesDeductions.filter(d => d.companyId === run.companyId);
  const companyPSAccounts = payStubAccounts.filter(a => a.companyId === run.companyId);
  const companyAccrualAccounts = accrualAccountsList.filter(a => a.companyId === run.companyId);
  const getWorker = (id: string) => workers.find(w => w.id === id);

  const CheckComponent = templateType === "voucher" ? VoucherCheck :
    templateType === "three-part" ? ThreePartCheck : StandardCheck;

  // Per-stub mode (?worker=): show that specific worker's stub regardless of payment method
  // Batch checks mode (no ?worker=): filter to check-payment workers only
  const checkWorkerItems = workerFilter
    ? items.filter(item => item.workerId === workerFilter)
    : items.filter(item => (!item.paymentMethod || item.paymentMethod === "check") && Number(item.netPay || 0) > 0);
  // Track how many zero-pay employees were skipped (for the full run only)
  const zeroPaySkippedCount = !workerFilter
    ? items.filter(item => (!item.paymentMethod || item.paymentMethod === "check") && Number(item.netPay || 0) <= 0).length
    : 0;

  // ── Duplicate check number detection ──
  const checkNumbersSeen = new Set<string>();
  const duplicateCheckNumbers = new Set<string>();
  checkWorkerItems.forEach(item => {
    const cn = String(item.checkNumber || "").trim();
    if (cn) {
      if (checkNumbersSeen.has(cn)) duplicateCheckNumbers.add(cn);
      else checkNumbersSeen.add(cn);
    }
  });

  // ── Pre-render validation (check mode only) ──
  const checkItemsWithValidation = !isPacketMode ? checkWorkerItems.map(item => {
    const worker = getWorker(item.workerId);
    const remittanceSource = remittanceSources.find(s => s.companyId === run.companyId && s.status === "enabled") || remittanceSources.find(s => s.companyId === run.companyId);
    const issues = validateCheckReadiness(item, worker, remittanceSources, run.companyId, micrFontLoaded, run.payDate);
    // Duplicate check number warning
    const cn = String(item.checkNumber || "").trim();
    if (cn && duplicateCheckNumbers.has(cn)) {
      issues.push({ severity: "blocking", field: "checkNumber", message: `Check number ${cn} is assigned to multiple employees in this run — duplicate check numbers are not allowed`, fixPath: "/app/payroll?tab=process", fixLabel: "Open Payroll" });
    }
    return { item, worker, issues, remittanceSource };
  }) : [];

  const hasBlockingIssues = !isPacketMode && checkItemsWithValidation.some(c => c.issues.some(i => i.severity === "blocking"));
  const totalCheckAmount = checkWorkerItems.reduce((sum, i) => sum + Number(i.netPay || 0), 0);

  const printLabel = isPacketMode
    ? "Print Payroll Packet"
    : workerFilter
      ? `Print Pay Stub (1)`
      : `Print Checks (${checkWorkerItems.length})`;

  return (
    <div>
      <div className="p-4 flex items-center gap-3 print-hide flex-wrap" data-testid="div-print-controls">
        <Link href="/app/payroll?tab=process">
          <Button variant="outline" data-testid="button-back-payroll">
            <ArrowLeft className="mr-2 h-4 w-4" />Back to Payroll
          </Button>
        </Link>
        <Button
          onClick={() => handlePrint(checkItemsWithValidation, runId!, company?.id, activeTemplate?.id, totalCheckAmount)}
          disabled={!fontReady || hasBlockingIssues}
          data-testid="button-print-checks"
          title={hasBlockingIssues ? "Resolve blocking issues in the diagnostics panel below before printing" : undefined}
        >
          <Printer className="mr-2 h-4 w-4" />{fontReady ? printLabel : "Loading fonts…"}
        </Button>
        {!isPacketMode && (
          <Link href={`/app/print-check/${runId}?packet=1`}>
            <Button variant="outline" size="sm" data-testid="button-switch-to-packet">
              <FileText className="mr-2 h-4 w-4" />Print Payroll Packet
            </Button>
          </Link>
        )}
        {isPacketMode && (
          <Link href={`/app/print-check/${runId}`}>
            <Button variant="outline" size="sm" data-testid="button-switch-to-checks">
              <Printer className="mr-2 h-4 w-4" />Print Checks Only
            </Button>
          </Link>
        )}
        <span className="text-sm text-muted-foreground" data-testid="text-check-info">
          {isPacketMode ? "Payroll Packet" : workerFilter ? "Pay Stub" : `${checkWorkerItems.length} check(s)`} for {company?.name || ""} — Template: {activeTemplate?.name || "Default"}
          <span className="ml-2 text-muted-foreground text-xs">· Pre-printed check stock</span>
        </span>
      </div>

      {isLocked && (
        <div className="mx-4 mb-3 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3 text-sm text-amber-800 dark:text-amber-300 flex items-center gap-2 print-hide" data-testid="banner-finalized-readonly">
          <Lock className="h-4 w-4 shrink-0" />
          <span>
            <strong>Finalized — Read Only.</strong> This payroll run is {run.status}. Check and stub outputs are read-only snapshots. To make changes, reopen the run for editing from the Payroll tab.
          </span>
        </div>
      )}

      {hasBlockingIssues && fontReady && (
        <div className="mx-4 mb-3 rounded-md border border-red-400 bg-red-50 dark:bg-red-950/20 p-3 text-sm text-red-700 dark:text-red-400 flex items-center gap-2 print-hide" data-testid="banner-print-blocked">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            <strong>Printing is blocked.</strong> {checkItemsWithValidation.filter(c => c.issues.some(i => i.severity === "blocking")).length} check(s) have blocking issues. Expand the diagnostics panel below to see fix paths.
          </span>
        </div>
      )}

      {zeroPaySkippedCount > 0 && fontReady && !isPacketMode && (
        <div className="mx-4 mb-3 rounded-md border border-blue-300 bg-blue-50 dark:bg-blue-950/20 p-3 text-sm text-blue-700 dark:text-blue-300 flex items-center gap-2 print-hide" data-testid="banner-zero-pay-skipped">
          <span>
            <strong>{zeroPaySkippedCount} employee{zeroPaySkippedCount > 1 ? "s" : ""} skipped</strong> — {zeroPaySkippedCount > 1 ? "their" : "their"} net pay is $0.00 so no check will be printed.
          </span>
        </div>
      )}

      {/* MICR font warning banner — screen only */}
      {micrFontLoaded === false && (
        <div className="mx-4 mb-3 p-3 bg-amber-50 border border-amber-300 rounded text-amber-800 text-sm print-hide" style={{ maxWidth: "8.5in" }}>
          <strong>⚠ MICR font not detected.</strong> The MICRNumeric (micrenc.ttf) font failed to load.
          The MICR line on printed checks will fall back to a plain monospace font and will <strong>not</strong> be magnetically readable.
          Verify that <code>/fonts/micrenc.ttf</code> is accessible and reload this page.
        </div>
      )}

      {/* Diagnostics panel — screen only, check mode only */}
      {!isPacketMode && fontReady && checkItemsWithValidation.length > 0 && (
        <CheckDiagnosticsPanel
          checkItemsWithValidation={checkItemsWithValidation}
          micrFontLoaded={micrFontLoaded}
          templateName={activeTemplate?.name || "Default"}
          fundingAccountId={(run as any).fundingAccountId}
        />
      )}

      {/* Calibration panel — screen only, check mode only */}
      {!isPacketMode && (
        <CalibrationPanel
          remittanceSourceId={activeRemittanceSource?.id}
          calibration={calibration}
          onChange={setCalibration}
          onSave={() => saveCalibrationMutation.mutate()}
          onTestPrint={handleCalibrationTestPrint}
          saving={saveCalibrationMutation.isPending}
        />
      )}

      {calibrationTestMode && (
        <div className="mx-4 mb-3 rounded-md border border-indigo-400 bg-indigo-100 p-3 text-sm text-indigo-800 flex items-center gap-2 print-hide">
          <Crosshair className="h-4 w-4 shrink-0" />
          <span><strong>Calibration Test Mode:</strong> Guide markers are visible. The print dialog will open with field outlines shown. Use them to identify each element's position on your check stock.</span>
        </div>
      )}

      <div className="print-content">
        {isPacketMode && company ? (
          <>
            <PayrollPacketSummaryPage run={run} items={items} workers={workers} company={company} />
            {checkWorkerItems.map((item) => {
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
                  calibration={calibration}
                  showGuides={calibrationTestMode}
                />
              );
            })}
          </>
        ) : (
          checkItemsWithValidation.map(({ item, worker, issues }) => {
            if (!company) return null;
            const hasBlocking = issues.some(i => i.severity === "blocking");
            if (hasBlocking || !worker) {
              return (
                <CheckValidationErrorCard
                  key={item.id}
                  item={item}
                  worker={worker}
                  issues={issues.length > 0 ? issues : [{ severity: "blocking", field: "worker", message: "Worker record not found", fixPath: "/app/employees", fixLabel: "Open Employees" }]}
                />
              );
            }
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
                calibration={calibration}
                showGuides={calibrationTestMode}
              />
            );
          })
        )}
      </div>

      <style>{`
        @media print {
          @page { size: 8.5in 11in; margin: 0; }
          .print-hide { display: none !important; }
          [data-sidebar], [data-sidebar="sidebar"], aside, nav,
          .trial-banner, [role="banner"], header { display: none !important; }
          .check-page { page-break-after: always; }
          .packet-page { page-break-after: always; }
          .print-content { display: block; }
          .flex.h-screen { display: block !important; }
          main { overflow: visible !important; }
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
          .packet-page {
            background: white;
            box-shadow: 0 2px 8px rgba(0,0,0,0.15);
          }
        }
      `}</style>
    </div>
  );
}
