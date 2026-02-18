import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Clock,
  Play,
  Square,
  Coffee,
  ArrowRight,
  LogOut,
  Hash,
  Lock,
  Fingerprint,
  Activity,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Worker, Company, TimePunch } from "@shared/schema";
import paylinkLogo from "@assets/PayLink_Logo_transparent_1771416877301.png";

function LiveClock() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="text-center" data-testid="text-live-clock">
      <div className="flex items-baseline justify-center gap-1">
        <span className="text-7xl font-light tracking-tight tabular-nums">
          {time.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}
        </span>
        <div className="flex flex-col items-start">
          <span className="text-2xl font-light tabular-nums text-teal-accent">
            {time.getSeconds().toString().padStart(2, "0")}
          </span>
        </div>
      </div>
      <p className="text-sm text-muted-foreground mt-3 tracking-wide uppercase">
        {time.toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
        })}
      </p>
    </div>
  );
}

function NumPad({ onInput, onClear, onBackspace }: {
  onInput: (digit: string) => void;
  onClear: () => void;
  onBackspace: () => void;
}) {
  const digits = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "<"];
  return (
    <div className="grid grid-cols-3 gap-2 max-w-[260px] mx-auto">
      {digits.map((d) => (
        <Button
          key={d}
          variant={d === "C" ? "destructive" : d === "<" ? "secondary" : "outline"}
          className="text-lg font-medium"
          onClick={() => {
            if (d === "C") onClear();
            else if (d === "<") onBackspace();
            else onInput(d);
          }}
          data-testid={`button-numpad-${d === "<" ? "back" : d}`}
        >
          {d === "<" ? "\u232B" : d}
        </Button>
      ))}
    </div>
  );
}

function PunchButton({
  type,
  icon: Icon,
  label,
  variant,
  workerId,
  companyId,
}: {
  type: string;
  icon: any;
  label: string;
  variant: "default" | "destructive" | "secondary";
  workerId: string;
  companyId: string;
}) {
  const { toast } = useToast();

  const punchMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/time-punches", {
        workerId,
        companyId,
        punchType: type,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-punches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: `${label} recorded` });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  return (
    <Button
      variant={variant}
      size="lg"
      className="flex-1"
      onClick={() => punchMutation.mutate()}
      disabled={punchMutation.isPending}
      data-testid={`button-punch-${type}`}
    >
      <Icon className="h-5 w-5 mr-2" />
      {punchMutation.isPending ? "..." : label}
    </Button>
  );
}

export default function TimeClock() {
  const { toast } = useToast();
  const [authenticatedWorker, setAuthenticatedWorker] = useState<Worker | null>(null);
  const [authenticatedCompany, setAuthenticatedCompany] = useState<Company | null>(null);
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [pin, setPin] = useState("");
  const [activeField, setActiveField] = useState<"empNum" | "pin">("empNum");
  const [authError, setAuthError] = useState("");

  const { data: punches } = useQuery<TimePunch[]>({
    queryKey: ["/api/time-punches"],
    enabled: !!authenticatedWorker,
  });

  const authMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/time-clock/auth", {
        employeeNumber,
        pin,
      });
      return res.json();
    },
    onSuccess: (data: { worker: Worker; company: Company }) => {
      setAuthenticatedWorker(data.worker);
      setAuthenticatedCompany(data.company);
      setAuthError("");
      setEmployeeNumber("");
      setPin("");
    },
    onError: () => {
      setAuthError("Invalid employee number or PIN");
      setPin("");
    },
  });

  const workerPunches = (punches || [])
    .filter((p) => p.workerId === authenticatedWorker?.id)
    .sort((a, b) => new Date(b.punchTime).getTime() - new Date(a.punchTime).getTime());

  const lastPunch = workerPunches[0];
  const isClockedIn = lastPunch?.punchType === "clock_in" || lastPunch?.punchType === "break_end";
  const isOnBreak = lastPunch?.punchType === "break_start";

  function handleNumInput(digit: string) {
    if (activeField === "empNum") {
      setEmployeeNumber((prev) => prev + digit);
    } else {
      setPin((prev) => prev + digit);
    }
  }

  function handleClear() {
    if (activeField === "empNum") setEmployeeNumber("");
    else setPin("");
  }

  function handleBackspace() {
    if (activeField === "empNum") setEmployeeNumber((prev) => prev.slice(0, -1));
    else setPin((prev) => prev.slice(0, -1));
  }

  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!employeeNumber || !pin) {
      setAuthError("Please enter both employee number and PIN");
      return;
    }
    authMutation.mutate();
  }

  function handleLogout() {
    setAuthenticatedWorker(null);
    setAuthenticatedCompany(null);
    setEmployeeNumber("");
    setPin("");
    setAuthError("");
  }

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    if (authenticatedWorker) {
      timeout = setTimeout(() => {
        handleLogout();
      }, 120000);
    }
    return () => clearTimeout(timeout);
  }, [authenticatedWorker, workerPunches]);

  if (!authenticatedWorker) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-60px)] p-4 bg-gradient-to-br from-background via-background to-muted/50">
        <div className="w-full max-w-md space-y-6">
          <div className="flex flex-col items-center gap-2">
            <img src={paylinkLogo} alt="PayLink" className="h-20 w-20 object-contain" />
            <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-timeclock-title">Time Clock</h1>
            <p className="text-sm text-muted-foreground">Enter your credentials to punch in or out</p>
          </div>

          <Card>
            <CardContent className="p-6 space-y-6">
              <LiveClock />

              <div className="h-px bg-border" />

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="empNum" className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                    <Hash className="h-3.5 w-3.5 text-blue-accent" /> Employee Number
                  </Label>
                  <Input
                    id="empNum"
                    value={employeeNumber}
                    onChange={(e) => setEmployeeNumber(e.target.value)}
                    onFocus={() => setActiveField("empNum")}
                    placeholder="Enter employee number"
                    autoComplete="off"
                    data-testid="input-employee-number"
                    className={activeField === "empNum" ? "ring-2 ring-teal-accent/50 border-teal-accent" : ""}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="pin" className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                    <Lock className="h-3.5 w-3.5 text-blue-accent" /> PIN
                  </Label>
                  <Input
                    id="pin"
                    type="password"
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    onFocus={() => setActiveField("pin")}
                    placeholder="Enter PIN"
                    autoComplete="off"
                    data-testid="input-pin"
                    className={activeField === "pin" ? "ring-2 ring-teal-accent/50 border-teal-accent" : ""}
                  />
                </div>

                <NumPad
                  onInput={handleNumInput}
                  onClear={handleClear}
                  onBackspace={handleBackspace}
                />

                {authError && (
                  <p className="text-sm text-destructive text-center" data-testid="text-auth-error">
                    {authError}
                  </p>
                )}

                <Button
                  type="submit"
                  size="lg"
                  className="w-full"
                  disabled={authMutation.isPending || !employeeNumber || !pin}
                  data-testid="button-clock-login"
                >
                  <Fingerprint className="h-5 w-5 mr-2" />
                  {authMutation.isPending ? "Authenticating..." : "Sign In"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-60px)] p-4 bg-gradient-to-br from-background via-background to-muted/50">
      <div className="w-full max-w-lg space-y-4">
        <Card>
          <CardContent className="p-6 space-y-6">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="text-sm font-semibold text-teal-accent">
                    {authenticatedWorker.firstName?.[0]}{authenticatedWorker.lastName?.[0]}
                  </span>
                </div>
                <div>
                  <h2 className="text-lg font-semibold" data-testid="text-worker-name">
                    {authenticatedWorker.firstName} {authenticatedWorker.lastName}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {authenticatedWorker.jobTitle} {authenticatedCompany && `\u00B7 ${authenticatedCompany.name}`}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleLogout}
                data-testid="button-clock-logout"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>

            <LiveClock />

            <div className="flex items-center justify-center gap-3">
              <div className={`h-2.5 w-2.5 rounded-full ${
                isClockedIn ? "bg-green-500 animate-pulse" :
                isOnBreak ? "bg-amber-500 animate-pulse" :
                "bg-muted-foreground/40"
              }`} />
              <Badge
                variant={isClockedIn ? "default" : isOnBreak ? "secondary" : "outline"}
                data-testid="badge-clock-status"
              >
                {isClockedIn ? "Clocked In" : isOnBreak ? "On Break" : "Clocked Out"}
              </Badge>
              {lastPunch && (
                <span className="text-xs text-muted-foreground">
                  since {new Date(lastPunch.punchTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                </span>
              )}
            </div>

            <div className="flex gap-3">
              {!isClockedIn && !isOnBreak ? (
                <PunchButton
                  type="clock_in"
                  icon={Play}
                  label="Clock In"
                  variant="default"
                  workerId={authenticatedWorker.id}
                  companyId={authenticatedWorker.companyId}
                />
              ) : (
                <>
                  {isClockedIn && (
                    <PunchButton
                      type="break_start"
                      icon={Coffee}
                      label="Break"
                      variant="secondary"
                      workerId={authenticatedWorker.id}
                      companyId={authenticatedWorker.companyId}
                    />
                  )}
                  {isOnBreak && (
                    <PunchButton
                      type="break_end"
                      icon={ArrowRight}
                      label="End Break"
                      variant="secondary"
                      workerId={authenticatedWorker.id}
                      companyId={authenticatedWorker.companyId}
                    />
                  )}
                  <PunchButton
                    type="clock_out"
                    icon={Square}
                    label="Clock Out"
                    variant="destructive"
                    workerId={authenticatedWorker.id}
                    companyId={authenticatedWorker.companyId}
                  />
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {workerPunches.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Activity className="h-4 w-4 text-teal-accent" />
                Today's Activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                {workerPunches.slice(0, 10).map((punch) => (
                  <div
                    key={punch.id}
                    className="flex items-center justify-between py-2.5 border-b last:border-0"
                    data-testid={`row-punch-${punch.id}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`h-2 w-2 rounded-full ${
                        punch.punchType === "clock_in" ? "bg-green-500" :
                        punch.punchType === "clock_out" ? "bg-red-500" :
                        "bg-amber-500"
                      }`} />
                      <span className="text-sm capitalize">
                        {punch.punchType.replace(/_/g, " ")}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {new Date(punch.punchTime).toLocaleTimeString("en-US", {
                        hour: "numeric",
                        minute: "2-digit",
                        hour12: true,
                      })}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
