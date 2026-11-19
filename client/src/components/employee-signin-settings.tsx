/**
 * Settings → Employee sign-in (administrators).
 *
 * Shows the company sign-in code employees enter (once per device) together
 * with their employee number and PIN, lets an administrator regenerate it, and
 * manages time-clock kiosk devices. Regenerating invalidates "remembered
 * company" devices; kiosks and active sessions are kept unless chosen.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { KeyRound, Monitor, RefreshCw, Copy, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface CodeInfo { code: string; codeVersion: number; rotatedAt: string | null }
interface Kiosk { id: string; label: string; created_at: string; last_seen_at: string | null; revoked_at: string | null }

const CODE_KEY = ["/api/company-signin/code"];
const KIOSK_KEY = ["/api/time-clock/kiosks"];

export function EmployeeSigninSettings() {
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [revokeKiosks, setRevokeKiosks] = useState(false);
  const [endSessions, setEndSessions] = useState(false);
  const [deviceLabel, setDeviceLabel] = useState("");

  const codeQ = useQuery<CodeInfo>({ queryKey: CODE_KEY, retry: false });
  const kiosksQ = useQuery<Kiosk[]>({ queryKey: KIOSK_KEY, retry: false, enabled: codeQ.isSuccess });

  const rotate = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/company-signin/code/rotate", { revokeKiosks, endEmployeeSessions: endSessions })).json(),
    onSuccess: (r: { kiosksRevoked: number; sessionsEnded: number }) => {
      queryClient.invalidateQueries({ queryKey: CODE_KEY });
      queryClient.invalidateQueries({ queryKey: KIOSK_KEY });
      setConfirmOpen(false); setRevokeKiosks(false); setEndSessions(false);
      toast({ title: "New sign-in code created", description: `Share it with your employees. Devices removed: ${r.kiosksRevoked}. Sessions ended: ${r.sessionsEnded}.` });
    },
    onError: (e: Error) => toast({ title: "Could not regenerate the code", description: e.message, variant: "destructive" }),
  });

  const bind = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/time-clock/kiosks", { label: deviceLabel.trim() })).json(),
    onSuccess: () => {
      setDeviceLabel("");
      queryClient.invalidateQueries({ queryKey: KIOSK_KEY });
      toast({ title: "This device is now a time clock", description: "Open /time-clock on this device. Employees won't need to enter the company code here." });
    },
    onError: (e: Error) => toast({ title: "Could not set up this device", description: e.message, variant: "destructive" }),
  });

  const revoke = useMutation({
    mutationFn: async (id: string) => (await apiRequest("POST", `/api/time-clock/kiosks/${id}/revoke`, {})).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: KIOSK_KEY }); toast({ title: "Time-clock device removed" }); },
    onError: (e: Error) => toast({ title: "Could not remove the device", description: e.message, variant: "destructive" }),
  });

  if (codeQ.isError) {
    const msg = (codeQ.error as Error)?.message || "";
    if (/^403|^401/.test(msg)) return null; // not an administrator
    return (
      <Card data-testid="card-employee-signin">
        <CardContent className="p-4 text-sm text-muted-foreground">
          {/^503/.test(msg) ? "Company sign-in codes are not enabled yet." : "Could not load employee sign-in settings."}
        </CardContent>
      </Card>
    );
  }

  const active = (kiosksQ.data ?? []).filter((k) => !k.revoked_at);

  return (
    <Card data-testid="card-employee-signin">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-primary" aria-hidden="true" /> Employee sign-in
        </CardTitle>
        <CardDescription className="text-xs">
          Employees sign in with this company code, their employee number and their PIN. The code only selects your company —
          it is not a password. Each device asks for it once.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <code className="rounded-md border bg-muted px-3 py-2 font-mono text-lg tracking-widest" data-testid="text-signin-code">
            {codeQ.data?.code ?? "…"}
          </code>
          <Button type="button" variant="outline" size="sm" disabled={!codeQ.data} data-testid="button-copy-signin-code"
            onClick={() => { if (codeQ.data) navigator.clipboard?.writeText(codeQ.data.code).then(() => toast({ title: "Code copied" }), () => {}); }}>
            <Copy className="h-4 w-4 mr-1" aria-hidden="true" /> Copy
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setConfirmOpen(true)} data-testid="button-rotate-signin-code">
            <RefreshCw className="h-4 w-4 mr-1" aria-hidden="true" /> Regenerate
          </Button>
          {codeQ.data?.rotatedAt && (
            <span className="text-xs text-muted-foreground">Last changed {new Date(codeQ.data.rotatedAt).toLocaleString()}</span>
          )}
        </div>

        <div className="space-y-2">
          <h3 className="text-xs font-semibold flex items-center gap-2"><Monitor className="h-3.5 w-3.5" aria-hidden="true" /> Time-clock devices</h3>
          <p className="text-xs text-muted-foreground">
            A time-clock device is locked to your company: employees enter only their employee number and PIN, and the company can't be changed from the device.
          </p>
          <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
            <div className="flex-1 space-y-1">
              <Label htmlFor="kiosk-label" className="text-xs">Set up this device as a time clock</Label>
              <Input id="kiosk-label" placeholder="Device name, e.g. Front desk tablet" value={deviceLabel} maxLength={80}
                onChange={(e) => setDeviceLabel(e.target.value)} data-testid="input-kiosk-label" />
            </div>
            <Button type="button" size="sm" disabled={!deviceLabel.trim() || bind.isPending} onClick={() => bind.mutate()} data-testid="button-bind-kiosk">
              Use this device as a time clock
            </Button>
          </div>
          <ul className="divide-y rounded-md border" data-testid="list-kiosks">
            {active.length === 0 && <li className="p-3 text-xs text-muted-foreground">No time-clock devices yet.</li>}
            {active.map((k) => (
              <li key={k.id} className="flex items-center justify-between gap-2 p-3 text-sm" data-testid={`row-kiosk-${k.id}`}>
                <span className="min-w-0">
                  <span className="font-medium">{k.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    Added {new Date(k.created_at).toLocaleDateString()}{k.last_seen_at ? ` · last used ${new Date(k.last_seen_at).toLocaleString()}` : ""}
                  </span>
                </span>
                <Button type="button" variant="ghost" size="sm" aria-label={`Remove ${k.label}`} onClick={() => revoke.mutate(k.id)} data-testid={`button-revoke-kiosk-${k.id}`}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Regenerate the sign-in code?</AlertDialogTitle>
            <AlertDialogDescription>
              The old code stops working immediately and devices that remembered your company will ask for the new one.
              Employees who are already signed in stay signed in unless you choose otherwise.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 py-2">
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={revokeKiosks} onCheckedChange={(v) => setRevokeKiosks(v === true)} data-testid="checkbox-revoke-kiosks" />
              <span>Also remove all time-clock devices</span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={endSessions} onCheckedChange={(v) => setEndSessions(v === true)} data-testid="checkbox-end-sessions" />
              <span>Also sign out all employees and contractors now</span>
            </label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-rotate">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); rotate.mutate(); }} disabled={rotate.isPending} data-testid="button-confirm-rotate">
              Regenerate code
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
