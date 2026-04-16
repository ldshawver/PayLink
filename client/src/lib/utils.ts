import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Recursively convert snake_case keys to camelCase.
 * Handles nested objects and arrays.
 */
export function snakeToCamel(obj: any): any {
  if (Array.isArray(obj)) return obj.map(snakeToCamel);
  if (obj !== null && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [
        k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
        snakeToCamel(v),
      ])
    );
  }
  return obj;
}

/**
 * Normalize a template record from the API (snake_case) to the camelCase shape
 * expected by the SettingsSection form. Handles both raw API responses and
 * already-normalized objects so it is safe to call multiple times.
 */
export function normalizeTemplate(tpl: any): Record<string, any> {
  return {
    ...tpl,
    templateType: tpl.template_type ?? tpl.templateType ?? "proposal",
    isActive: tpl.is_active ?? tpl.isActive ?? true,
    isDefault: tpl.is_default ?? tpl.isDefault ?? false,
    isGlobal: tpl.is_global ?? tpl.isGlobal ?? false,
    layoutVariant: tpl.layout_variant ?? tpl.layoutVariant ?? "standard",
    workTypeTags: tpl.work_type_tags ?? tpl.workTypeTags ?? "",
    createdByUserId: tpl.created_by_user_id ?? tpl.createdByUserId ?? null,
    companyId: tpl.company_id ?? tpl.companyId ?? null,
    bodyJson: tpl.body_json ?? tpl.bodyJson ?? null,
    defaultPaymentTerms: tpl.default_payment_terms ?? tpl.defaultPaymentTerms ?? "",
    defaultScopeTemplate: tpl.default_scope_template ?? tpl.defaultScopeTemplate ?? "",
    defaultAssumptions: tpl.default_assumptions ?? tpl.defaultAssumptions ?? "",
    defaultExclusions: tpl.default_exclusions ?? tpl.defaultExclusions ?? "",
    defaultWarranty: tpl.default_warranty ?? tpl.defaultWarranty ?? "",
  };
}
