import type { CSSProperties } from "react";

interface InvoiceFullData {
  id: string;
  invoiceNumber: string;
  status: string;
  issueDate?: string;
  dueDate?: string;
  subtotal?: string;
  taxRate?: string;
  taxAmount?: string;
  totalAmount?: string;
  amountPaid?: string;
  amountDue?: string;
  notes?: string;
  paymentTerms?: string;
  templateStyle?: string;
  companyName?: string;
  companyAddress?: string;
  companyCity?: string;
  companyState?: string;
  companyZip?: string;
  companyPhone?: string;
  companyEmail?: string;
  companyLogoUrl?: string;
  customerName?: string;
  customerBusinessName?: string;
  customerEmail?: string;
  customerPhone?: string;
  customerAddress?: string;
  customerCity?: string;
  customerState?: string;
  customerZip?: string;
  lineItems?: Array<{
    id?: string;
    description: string;
    quantity?: string;
    unitPrice?: string;
    amount?: string;
  }>;
}

const fmt = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

const fmtDate = (d?: string) =>
  d ? new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "";

function AddressBlock({ label, name, address, city, state, zip, email, phone }: {
  label: string; name?: string; address?: string; city?: string; state?: string; zip?: string; email?: string; phone?: string;
}) {
  const hasInfo = name || address || city || email || phone;
  if (!hasInfo) return null;
  const cityStateZip = [city, state, zip].filter(Boolean).join(", ");
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4, opacity: 0.6 }}>{label}</div>
      {name && <div style={{ fontWeight: 600, fontSize: 14 }}>{name}</div>}
      {address && <div style={{ fontSize: 13 }}>{address}</div>}
      {cityStateZip && <div style={{ fontSize: 13 }}>{cityStateZip}</div>}
      {email && <div style={{ fontSize: 12, opacity: 0.75 }}>{email}</div>}
      {phone && <div style={{ fontSize: 12, opacity: 0.75 }}>{phone}</div>}
    </div>
  );
}

function LineItemsTable({ items, style }: { items: InvoiceFullData["lineItems"]; style: string }) {
  if (!items || items.length === 0) return null;
  const isClassic = style === "classic";
  const isBold = style === "bold_accent";
  const headerBg = isClassic ? "#1e3a5f" : isBold ? "#111827" : style === "modern_clean" ? "#0d9488" : "#f8fafc";
  const headerColor = (isClassic || isBold || style === "modern_clean") ? "#fff" : "#475569";

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 24 }}>
      <thead>
        <tr style={{ background: headerBg }}>
          {["Description", "Qty", "Unit Price", "Amount"].map((h, i) => (
            <th key={h} style={{
              padding: "10px 12px",
              textAlign: i === 0 ? "left" : "right",
              fontSize: 12,
              fontWeight: 600,
              color: headerColor,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {items.map((li, idx) => (
          <tr key={li.id || idx} style={{ background: idx % 2 === 1 ? "#f9fafb" : "#fff" }}>
            <td style={{ padding: "10px 12px", fontSize: 13, borderBottom: "1px solid #f1f5f9" }}>{li.description}</td>
            <td style={{ padding: "10px 12px", fontSize: 13, textAlign: "right", borderBottom: "1px solid #f1f5f9" }}>{li.quantity || "1"}</td>
            <td style={{ padding: "10px 12px", fontSize: 13, textAlign: "right", borderBottom: "1px solid #f1f5f9" }}>{fmt(parseFloat(li.unitPrice || "0"))}</td>
            <td style={{ padding: "10px 12px", fontSize: 13, textAlign: "right", fontWeight: 500, borderBottom: "1px solid #f1f5f9" }}>{fmt(parseFloat(li.amount || "0"))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TotalsSection({ invoice, style }: { invoice: InvoiceFullData; style: string }) {
  const subtotal = parseFloat(invoice.subtotal || invoice.totalAmount || "0");
  const taxAmount = parseFloat(invoice.taxAmount || "0");
  const total = parseFloat(invoice.totalAmount || "0");
  const amountPaid = parseFloat(invoice.amountPaid || "0");
  const amountDue = parseFloat(invoice.amountDue || invoice.totalAmount || "0");
  const accentColor = style === "modern_clean" ? "#0d9488" : style === "classic" ? "#1e3a5f" : style === "bold_accent" ? "#f59e0b" : "#374151";

  return (
    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
      <div style={{ minWidth: 240 }}>
        {taxAmount > 0 && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13 }}>
              <span style={{ color: "#64748b" }}>Subtotal</span>
              <span>{fmt(subtotal)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13 }}>
              <span style={{ color: "#64748b" }}>Tax ({invoice.taxRate || "0"}%)</span>
              <span>{fmt(taxAmount)}</span>
            </div>
          </>
        )}
        {amountPaid > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13 }}>
            <span style={{ color: "#64748b" }}>Amount Paid</span>
            <span style={{ color: "#16a34a" }}>-{fmt(amountPaid)}</span>
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", fontSize: 16, fontWeight: 700, borderTop: `2px solid ${accentColor}`, marginTop: 4 }}>
          <span style={{ color: accentColor }}>Total Due</span>
          <span style={{ color: accentColor }}>{fmt(amountDue)}</span>
        </div>
      </div>
    </div>
  );
}

export function InvoicePreview({ invoice, className }: { invoice: InvoiceFullData; className?: string }) {
  const style = invoice.templateStyle || "modern_clean";

  const wrapperStyle: CSSProperties = {
    background: "#fff",
    maxWidth: 800,
    margin: "0 auto",
    fontFamily: "'Helvetica Neue', Arial, sans-serif",
    color: "#1e293b",
    borderRadius: style === "minimal" ? 0 : 8,
    overflow: "hidden",
    boxShadow: "0 1px 8px rgba(0,0,0,0.08)",
  };

  return (
    <div className={className} style={wrapperStyle} id="invoice-preview-root">
      {style === "modern_clean" && <ModernCleanInvoice invoice={invoice} />}
      {style === "classic" && <ClassicInvoice invoice={invoice} />}
      {style === "minimal" && <MinimalInvoice invoice={invoice} />}
      {style === "bold_accent" && <BoldAccentInvoice invoice={invoice} />}
    </div>
  );
}

function ModernCleanInvoice({ invoice }: { invoice: InvoiceFullData }) {
  return (
    <div>
      <div style={{ background: "linear-gradient(135deg, #0d9488 0%, #0369a1 100%)", padding: "32px 40px", color: "#fff" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            {invoice.companyLogoUrl && (
              <img src={invoice.companyLogoUrl} alt={invoice.companyName} style={{ height: 48, marginBottom: 12, objectFit: "contain" }} />
            )}
            <div style={{ fontSize: 22, fontWeight: 700 }}>{invoice.companyName || "Company"}</div>
            <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>{invoice.companyEmail}</div>
            <div style={{ fontSize: 12, opacity: 0.8 }}>{invoice.companyPhone}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.02em" }}>INVOICE</div>
            <div style={{ fontSize: 16, fontWeight: 500, opacity: 0.9, marginTop: 4 }}>#{invoice.invoiceNumber}</div>
          </div>
        </div>
      </div>
      <div style={{ padding: "28px 40px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 28 }}>
          <div style={{ display: "flex", gap: 40 }}>
            <AddressBlock label="From" name={invoice.companyName} address={invoice.companyAddress} city={invoice.companyCity} state={invoice.companyState} zip={invoice.companyZip} />
            <AddressBlock label="Bill To" name={invoice.customerName} address={invoice.customerAddress} city={invoice.customerCity} state={invoice.customerState} zip={invoice.customerZip} email={invoice.customerEmail} phone={invoice.customerPhone} />
          </div>
          <div style={{ textAlign: "right", minWidth: 160 }}>
            {invoice.issueDate && <div style={{ marginBottom: 8 }}><div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", opacity: 0.6, letterSpacing: "0.05em" }}>Issue Date</div><div style={{ fontSize: 13 }}>{fmtDate(invoice.issueDate)}</div></div>}
            {invoice.dueDate && <div style={{ marginBottom: 8 }}><div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", opacity: 0.6, letterSpacing: "0.05em" }}>Due Date</div><div style={{ fontSize: 13, color: "#dc2626", fontWeight: 600 }}>{fmtDate(invoice.dueDate)}</div></div>}
          </div>
        </div>
        <LineItemsTable items={invoice.lineItems} style="modern_clean" />
        <TotalsSection invoice={invoice} style="modern_clean" />
        {invoice.notes && (
          <div style={{ marginTop: 28, padding: "16px", background: "#f0fdfa", borderLeft: "3px solid #0d9488", borderRadius: "0 6px 6px 0" }}>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: "#0d9488", marginBottom: 6, letterSpacing: "0.05em" }}>Notes</div>
            <div style={{ fontSize: 13, color: "#475569" }}>{invoice.notes}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function ClassicInvoice({ invoice }: { invoice: InvoiceFullData }) {
  return (
    <div style={{ borderLeft: "5px solid #1e3a5f" }}>
      <div style={{ padding: "32px 40px", borderBottom: "3px solid #1e3a5f" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            {invoice.companyLogoUrl && (
              <img src={invoice.companyLogoUrl} alt={invoice.companyName} style={{ height: 48, marginBottom: 12, objectFit: "contain" }} />
            )}
            <div style={{ fontSize: 22, fontWeight: 700, color: "#1e3a5f" }}>{invoice.companyName || "Company"}</div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>{invoice.companyEmail}</div>
            <div style={{ fontSize: 12, color: "#64748b" }}>{invoice.companyPhone}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 36, fontWeight: 800, color: "#1e3a5f", letterSpacing: "-0.02em" }}>INVOICE</div>
            <div style={{ fontSize: 15, fontWeight: 500, color: "#475569" }}>#{invoice.invoiceNumber}</div>
          </div>
        </div>
      </div>
      <div style={{ padding: "28px 40px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 28 }}>
          <div style={{ display: "flex", gap: 40 }}>
            <AddressBlock label="From" name={invoice.companyName} address={invoice.companyAddress} city={invoice.companyCity} state={invoice.companyState} zip={invoice.companyZip} />
            <AddressBlock label="Bill To" name={invoice.customerName} address={invoice.customerAddress} city={invoice.customerCity} state={invoice.customerState} zip={invoice.customerZip} email={invoice.customerEmail} phone={invoice.customerPhone} />
          </div>
          <div style={{ textAlign: "right", minWidth: 160 }}>
            {invoice.issueDate && <div style={{ marginBottom: 8 }}><div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", color: "#64748b", letterSpacing: "0.05em" }}>Issue Date</div><div style={{ fontSize: 13 }}>{fmtDate(invoice.issueDate)}</div></div>}
            {invoice.dueDate && <div><div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", color: "#64748b", letterSpacing: "0.05em" }}>Due Date</div><div style={{ fontSize: 13, color: "#dc2626", fontWeight: 600 }}>{fmtDate(invoice.dueDate)}</div></div>}
          </div>
        </div>
        <LineItemsTable items={invoice.lineItems} style="classic" />
        <TotalsSection invoice={invoice} style="classic" />
        {invoice.notes && (
          <div style={{ marginTop: 28, padding: "16px", borderLeft: "3px solid #1e3a5f", background: "#f8fafc" }}>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: "#1e3a5f", marginBottom: 6, letterSpacing: "0.05em" }}>Notes</div>
            <div style={{ fontSize: 13, color: "#475569" }}>{invoice.notes}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function MinimalInvoice({ invoice }: { invoice: InvoiceFullData }) {
  return (
    <div style={{ border: "1px solid #e2e8f0" }}>
      <div style={{ padding: "36px 44px", borderBottom: "1px solid #e2e8f0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            {invoice.companyLogoUrl && (
              <img src={invoice.companyLogoUrl} alt={invoice.companyName} style={{ height: 44, marginBottom: 12, objectFit: "contain" }} />
            )}
            <div style={{ fontSize: 20, fontWeight: 700, color: "#111827" }}>{invoice.companyName || "Company"}</div>
            <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 3 }}>{invoice.companyEmail}</div>
            <div style={{ fontSize: 12, color: "#9ca3af" }}>{invoice.companyPhone}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#9ca3af", letterSpacing: "0.12em", textTransform: "uppercase" }}>Invoice</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#111827", marginTop: 4 }}>#{invoice.invoiceNumber}</div>
          </div>
        </div>
      </div>
      <div style={{ padding: "28px 44px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 28 }}>
          <div style={{ display: "flex", gap: 40 }}>
            <AddressBlock label="From" name={invoice.companyName} address={invoice.companyAddress} city={invoice.companyCity} state={invoice.companyState} zip={invoice.companyZip} />
            <AddressBlock label="Bill To" name={invoice.customerName} address={invoice.customerAddress} city={invoice.customerCity} state={invoice.customerState} zip={invoice.customerZip} email={invoice.customerEmail} phone={invoice.customerPhone} />
          </div>
          <div style={{ textAlign: "right", minWidth: 160 }}>
            {invoice.issueDate && <div style={{ marginBottom: 8 }}><div style={{ fontSize: 10, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>Issued</div><div style={{ fontSize: 13 }}>{fmtDate(invoice.issueDate)}</div></div>}
            {invoice.dueDate && <div><div style={{ fontSize: 10, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>Due</div><div style={{ fontSize: 13, fontWeight: 600 }}>{fmtDate(invoice.dueDate)}</div></div>}
          </div>
        </div>
        <LineItemsTable items={invoice.lineItems} style="minimal" />
        <TotalsSection invoice={invoice} style="minimal" />
        {invoice.notes && (
          <div style={{ marginTop: 28, paddingTop: 20, borderTop: "1px solid #e2e8f0" }}>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: "#9ca3af", marginBottom: 6, letterSpacing: "0.05em" }}>Notes</div>
            <div style={{ fontSize: 13, color: "#6b7280" }}>{invoice.notes}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function BoldAccentInvoice({ invoice }: { invoice: InvoiceFullData }) {
  return (
    <div>
      <div style={{ background: "#111827", padding: "32px 40px", color: "#fff" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            {invoice.companyLogoUrl && (
              <img src={invoice.companyLogoUrl} alt={invoice.companyName} style={{ height: 48, marginBottom: 12, objectFit: "contain", filter: "brightness(10)" }} />
            )}
            <div style={{ fontSize: 22, fontWeight: 700 }}>{invoice.companyName || "Company"}</div>
            <div style={{ display: "inline-block", background: "#f59e0b", color: "#111827", fontSize: 11, fontWeight: 700, padding: "2px 10px", borderRadius: 20, marginTop: 8, letterSpacing: "0.04em" }}>
              #{invoice.invoiceNumber}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 38, fontWeight: 900, letterSpacing: "-0.03em", color: "#f59e0b" }}>INVOICE</div>
          </div>
        </div>
      </div>
      <div style={{ padding: "28px 40px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 28 }}>
          <div style={{ display: "flex", gap: 40 }}>
            <AddressBlock label="From" name={invoice.companyName} address={invoice.companyAddress} city={invoice.companyCity} state={invoice.companyState} zip={invoice.companyZip} />
            <AddressBlock label="Bill To" name={invoice.customerName} address={invoice.customerAddress} city={invoice.customerCity} state={invoice.customerState} zip={invoice.customerZip} email={invoice.customerEmail} phone={invoice.customerPhone} />
          </div>
          <div style={{ textAlign: "right", minWidth: 160 }}>
            {invoice.issueDate && <div style={{ marginBottom: 8 }}><div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "#6b7280", letterSpacing: "0.06em" }}>Issue Date</div><div style={{ fontSize: 13 }}>{fmtDate(invoice.issueDate)}</div></div>}
            {invoice.dueDate && <div><div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "#6b7280", letterSpacing: "0.06em" }}>Due Date</div><div style={{ fontSize: 13, fontWeight: 700, color: "#dc2626" }}>{fmtDate(invoice.dueDate)}</div></div>}
          </div>
        </div>
        <LineItemsTable items={invoice.lineItems} style="bold_accent" />
        <TotalsSection invoice={invoice} style="bold_accent" />
        {invoice.notes && (
          <div style={{ marginTop: 28, padding: "14px 18px", background: "#fefce8", border: "1px solid #fde68a", borderRadius: 6 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#92400e", marginBottom: 6, letterSpacing: "0.05em" }}>Notes</div>
            <div style={{ fontSize: 13, color: "#78350f" }}>{invoice.notes}</div>
          </div>
        )}
      </div>
    </div>
  );
}
