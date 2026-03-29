import type { InsertDocumentRetentionPolicy } from "@shared/schema";

export interface RetentionRule {
  documentType: string;
  label: string;
  retentionYears?: number;
  retentionMonths?: number;
  rule: "from_hire_or_termination" | "from_creation" | "configurable";
  hireYears?: number;
  terminationYears?: number;
}

export const BUILT_IN_RETENTION_RULES: RetentionRule[] = [
  {
    documentType: "i-9",
    label: "I-9 (USCIS)",
    rule: "from_hire_or_termination",
    hireYears: 3,
    terminationYears: 1,
  },
  {
    documentType: "w-4",
    label: "W-4 / Employment Tax Records (IRS)",
    rule: "from_creation",
    retentionYears: 4,
  },
  {
    documentType: "w-9",
    label: "W-9 (Configurable)",
    rule: "configurable",
    retentionYears: 4,
  },
  {
    documentType: "employment",
    label: "General Employment Records",
    rule: "from_creation",
    retentionYears: 7,
  },
];

export function computeDispositionDate(
  documentType: string | null | undefined,
  hireDate: Date | string | null | undefined,
  terminationDate: Date | string | null | undefined,
  createdAt: Date | string | null | undefined,
  policyOverride?: { retentionYears?: number | null; retentionMonths?: number | null; retentionRule?: string | null }
): Date | null {
  const normalizedType = (documentType || "").toLowerCase().trim();
  const rule = BUILT_IN_RETENTION_RULES.find(r => r.documentType === normalizedType);

  const created = createdAt ? new Date(createdAt) : new Date();
  const hire = hireDate ? new Date(hireDate) : null;
  const termination = terminationDate ? new Date(terminationDate) : null;

  const effectiveRule = policyOverride?.retentionRule || rule?.rule || null;
  const effectiveYears = policyOverride?.retentionYears != null ? policyOverride.retentionYears : (rule?.retentionYears ?? 0);
  const effectiveMonths = policyOverride?.retentionMonths != null ? policyOverride.retentionMonths : (rule?.retentionMonths ?? 0);

  if (effectiveRule === "from_hire_or_termination") {
    const hireYrs = policyOverride?.retentionYears != null ? policyOverride.retentionYears : (rule?.hireYears ?? 3);
    const termYrs = rule?.terminationYears ?? 1;

    const candidates: Date[] = [];
    if (hire) {
      const d = new Date(hire);
      d.setFullYear(d.getFullYear() + hireYrs);
      candidates.push(d);
    }
    if (termination) {
      const d = new Date(termination);
      d.setFullYear(d.getFullYear() + termYrs);
      candidates.push(d);
    }
    if (candidates.length === 0) return null;
    return candidates.reduce((a, b) => (a > b ? a : b));
  }

  if (effectiveRule === "from_creation" || effectiveRule === "configurable") {
    const d = new Date(created);
    d.setFullYear(d.getFullYear() + effectiveYears);
    d.setMonth(d.getMonth() + effectiveMonths);
    return d;
  }

  if (policyOverride && (effectiveYears || effectiveMonths)) {
    const d = new Date(created);
    d.setFullYear(d.getFullYear() + effectiveYears);
    d.setMonth(d.getMonth() + effectiveMonths);
    return d;
  }

  return null;
}

export function getDefaultRetentionPolicySeedData(companyId: string): InsertDocumentRetentionPolicy[] {
  return [
    {
      companyId,
      name: "I-9 Retention (USCIS)",
      description: "Retain I-9 forms for 3 years after hire or 1 year after termination, whichever is later.",
      documentType: "i-9",
      retentionYears: 3,
      retentionRule: "from_hire_or_termination",
      dispositionAction: "archive",
      isActive: true,
    },
    {
      companyId,
      name: "W-4 / Employment Tax Records (IRS)",
      description: "Retain W-4 and employment tax records for at least 4 years per IRS requirements.",
      documentType: "w-4",
      retentionYears: 4,
      retentionRule: "from_creation",
      dispositionAction: "archive",
      isActive: true,
    },
    {
      companyId,
      name: "W-9 Retention (Configurable)",
      description: "Retain W-9 forms per company policy. Default: 4 years.",
      documentType: "w-9",
      retentionYears: 4,
      retentionRule: "configurable",
      dispositionAction: "archive",
      isActive: true,
    },
    {
      companyId,
      name: "General Employment Records",
      description: "Retain general employment records for 7 years.",
      documentType: "employment",
      retentionYears: 7,
      retentionRule: "from_creation",
      dispositionAction: "archive",
      isActive: true,
    },
  ];
}
