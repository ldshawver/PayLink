/**
 * Company sign-in code field for employee / time-clock sign-in.
 *
 * The code routes the sign-in to one company (it is not a password). Once a
 * sign-in with a typed code succeeds, the server remembers the company on this
 * device (HttpOnly cookie) and this field collapses to "Signing in to <Company>"
 * with a "Not your company?" link. On an admin-bound time-clock kiosk the
 * company is fixed and cannot be changed from the device.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface SigninContext {
  companyScoped: boolean;
  kiosk: boolean;
  kioskLabel?: string;
  remembered: boolean;
  companyName: string | null;
}

export const SIGNIN_CONTEXT_KEY = ["/api/auth/signin-context"] as const;

export function useSigninContext() {
  return useQuery<SigninContext>({
    queryKey: SIGNIN_CONTEXT_KEY,
    queryFn: async () => {
      const r = await fetch("/api/auth/signin-context", { credentials: "include", cache: "no-store" });
      if (!r.ok) return { companyScoped: true, kiosk: false, remembered: false, companyName: null };
      return r.json();
    },
    staleTime: 60_000,
  });
}

/** Formats as XXXX-XXXX while typing; server normalizes anyway. */
export function formatCompanyCodeInput(raw: string): string {
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return cleaned.length > 4 ? `${cleaned.slice(0, 4)}-${cleaned.slice(4)}` : cleaned;
}

/** True when the form must collect a code (no kiosk binding, nothing remembered). */
export function needsCompanyCode(ctx: SigninContext | undefined): boolean {
  if (!ctx) return true;
  if (!ctx.companyScoped) return false;
  return !ctx.kiosk && !ctx.remembered;
}

export function CompanySigninCodeField({
  value, onChange, idPrefix, onFocus, className,
}: {
  value: string;
  onChange: (v: string) => void;
  idPrefix: string;
  onFocus?: () => void;
  className?: string;
}) {
  const { data: ctx } = useSigninContext();
  const qc = useQueryClient();
  if (ctx && !ctx.companyScoped) return null;

  if (ctx?.kiosk) {
    return (
      <div className={`flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm ${className ?? ""}`} data-testid={`${idPrefix}-kiosk-company`}>
        <Building2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <span>Time clock for <strong>{ctx.companyName ?? "your company"}</strong></span>
      </div>
    );
  }
  if (ctx?.remembered) {
    return (
      <div className={`flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm ${className ?? ""}`} data-testid={`${idPrefix}-remembered-company`}>
        <span className="flex items-center gap-2 min-w-0">
          <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate">Signing in to <strong>{ctx.companyName}</strong></span>
        </span>
        <button
          type="button"
          className="shrink-0 text-xs text-primary underline-offset-2 hover:underline"
          data-testid={`${idPrefix}-change-company`}
          onClick={async () => {
            await fetch("/api/auth/signin-context/forget", { method: "POST", credentials: "include" }).catch(() => {});
            onChange("");
            await qc.invalidateQueries({ queryKey: SIGNIN_CONTEXT_KEY });
          }}
        >
          Not your company?
        </button>
      </div>
    );
  }
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <Label htmlFor={`${idPrefix}-company-code`} className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
        Company sign-in code
      </Label>
      <Input
        id={`${idPrefix}-company-code`}
        value={value}
        onChange={(e) => onChange(formatCompanyCodeInput(e.target.value))}
        onFocus={onFocus}
        placeholder="XXXX-XXXX"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        inputMode="text"
        maxLength={9}
        className="font-mono tracking-widest"
        data-testid={`${idPrefix}-input-company-code`}
        aria-describedby={`${idPrefix}-company-code-help`}
      />
      <p id={`${idPrefix}-company-code-help`} className="text-xs text-muted-foreground">
        Ask your manager for your company's sign-in code. You only need to enter it once on this device.
      </p>
    </div>
  );
}
