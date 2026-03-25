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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import type { EmployeeWageGroup, SecondaryWageGroup } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Worker, Company, TimePunch } from "@shared/schema";
import paylinkLogo from "@assets/PayLink_Logo_transparent_1771416877301.png";
import bgVideo from "@assets/Gen-4_5_Create_a_cinematic_animated_background_video_for_a_mod_1774400668621.mp4";

function VideoBackground() {
  return (
    <div className="fixed inset-0 z-0 overflow-hidden">
      <video
        autoPlay
        loop
        muted
        playsInline
        className="absolute w-full h-full object-cover"
        data-testid="video-background"
      >
        <source src={bgVideo} type="video/mp4" />
      </video>
      <div className="absolute inset-0 bg-gradient-to-br from-slate-900/85 via-teal-900/70 to-blue-900/80" />
      <div className="absolute inset-0 bg-black/30" />
    </div>
  );
}

function LiveClock() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="text-center" data-testid="text-live-clock">
      <div className="flex items-baseline justify-center gap-1">
        <span className="text-7xl font-light tracking-tight tabular-nums text-white drop-shadow-lg">
          {time.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}
        </span>
        <div className="flex flex-col items-start">
          <span className="text-2xl font-light tabular-nums text-teal-300 drop-shadow-md">
            {time.getSeconds().toString().padStart(2, "0")}
          </span>
        </div>
      </div>
      <p className="text-sm text-white/70 mt-3 tracking-wide uppercase drop-shadow-sm">
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
          variant={d === "C" ? "secondary" : d === "<" ? "secondary" : "outline"}
          className="text-lg font-medium h-12"
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
  wageGroupId,
  onSuccess: onSuccessCallback,
}: {
  type: string;
  icon: any;
  label: string;
  variant: "default" | "destructive" | "secondary";
  workerId: string;
  companyId: string;
  wageGroupId?: string;
  onSuccess?: () => void;
}) {
  const { toast } = useToast();

  const punchMutation = useMutation({
    mutationFn: async () => {
      const body: any = { workerId, companyId, punchType: type };
      if (wageGroupId) body.wageGroupId = wageGroupId;
      await apiRequest("POST", "/api/time-punches", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-punches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: `${label} recorded` });
      onSuccessCallback?.();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const buttonStyles = type === "clock_in"
    ? "bg-emerald-600 hover:bg-emerald-700 text-white border-0 shadow-lg shadow-emerald-900/30 text-base py-6"
    : type === "clock_out"
    ? "bg-red-600 hover:bg-red-700 text-white border-0 shadow-lg shadow-red-900/30 text-base py-6"
    : "bg-amber-500 hover:bg-amber-600 text-white border-0 shadow-lg shadow-amber-900/30 text-base py-6";

  return (
    <Button
      variant={variant}
      size="lg"
      className={`flex-1 ${buttonStyles}`}
      onClick={() => punchMutation.mutate()}
      disabled={punchMutation.isPending}
      data-testid={`button-punch-${type}`}
    >
      <Icon className="h-6 w-6 mr-2" />
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
  const [selectedWageGroupId, setSelectedWageGroupId] = useState("");

  const { data: punches } = useQuery<TimePunch[]>({
    queryKey: ["/api/time-punches"],
    enabled: !!authenticatedWorker,
  });

  const { data: employeeWageAssignments } = useQuery<EmployeeWageGroup[]>({
    queryKey: ["/api/employee-wage-groups", authenticatedWorker?.id],
    queryFn: async () => {
      const res = await fetch(`/api/employee-wage-groups?workerId=${authenticatedWorker!.id}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!authenticatedWorker,
  });

  const { data: allWageGroups } = useQuery<SecondaryWageGroup[]>({
    queryKey: ["/api/secondary-wage-groups"],
    enabled: !!authenticatedWorker,
  });

  const wgLookup: Record<string, SecondaryWageGroup> = {};
  allWageGroups?.forEach(wg => { wgLookup[wg.id] = wg; });
  const assignedWageGroups = (employeeWageAssignments || [])
    .map(a => wgLookup[a.wageGroupId])
    .filter(Boolean) as SecondaryWageGroup[];

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
    setSelectedWageGroupId("");
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
      <div className="relative flex items-center justify-center min-h-screen p-4">
        <VideoBackground />
        <div className="relative z-10 w-full max-w-md space-y-6">
          <div className="flex flex-col items-center gap-3">
            <img src={paylinkLogo} alt="PayLink" className="h-20 w-20 object-contain drop-shadow-2xl" />
            <h1 className="text-3xl font-bold tracking-tight text-white drop-shadow-lg" data-testid="text-timeclock-title">Time Clock</h1>
            <p className="text-sm text-white/60">Enter your credentials to punch in or out</p>
          </div>

          <Card className="bg-white/10 backdrop-blur-xl border-white/20 shadow-2xl">
            <CardContent className="p-6 space-y-6">
              <LiveClock />

              <div className="h-px bg-white/20" />

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="empNum" className="flex items-center gap-2 text-xs uppercase tracking-wider text-white/70">
                    <Hash className="h-3.5 w-3.5 text-teal-300" /> Employee Number
                  </Label>
                  <Input
                    id="empNum"
                    value={employeeNumber}
                    onChange={(e) => setEmployeeNumber(e.target.value)}
                    onFocus={() => setActiveField("empNum")}
                    placeholder="Enter employee number"
                    autoComplete="off"
                    data-testid="input-employee-number"
                    className={`bg-white/10 border-white/30 text-white placeholder:text-white/40 ${activeField === "empNum" ? "ring-2 ring-teal-400/60 border-teal-400" : ""}`}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="pin" className="flex items-center gap-2 text-xs uppercase tracking-wider text-white/70">
                    <Lock className="h-3.5 w-3.5 text-teal-300" /> PIN
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
                    className={`bg-white/10 border-white/30 text-white placeholder:text-white/40 ${activeField === "pin" ? "ring-2 ring-teal-400/60 border-teal-400" : ""}`}
                  />
                </div>

                <NumPad
                  onInput={handleNumInput}
                  onClear={handleClear}
                  onBackspace={handleBackspace}
                />

                {authError && (
                  <p className="text-sm text-red-300 text-center font-medium drop-shadow-sm" data-testid="text-auth-error">
                    {authError}
                  </p>
                )}

                <Button
                  type="submit"
                  size="lg"
                  className="w-full bg-teal-600 hover:bg-teal-700 text-white shadow-lg shadow-teal-900/40 py-6 text-base"
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
    <div className="relative flex items-center justify-center min-h-screen p-4">
      <VideoBackground />
      <div className="relative z-10 w-full max-w-lg space-y-4">
        <Card className="bg-white/10 backdrop-blur-xl border-white/20 shadow-2xl">
          <CardContent className="p-6 space-y-6">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-full bg-teal-500/30 backdrop-blur-sm flex items-center justify-center border border-teal-400/30">
                  <span className="text-sm font-bold text-teal-200">
                    {authenticatedWorker.firstName?.[0]}{authenticatedWorker.lastName?.[0]}
                  </span>
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white drop-shadow-md" data-testid="text-worker-name">
                    {authenticatedWorker.firstName} {authenticatedWorker.lastName}
                  </h2>
                  <p className="text-xs text-white/60">
                    {authenticatedWorker.jobTitle} {authenticatedCompany && `\u00B7 ${authenticatedCompany.name}`}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleLogout}
                className="text-white/60 hover:text-white hover:bg-white/10"
                data-testid="button-clock-logout"
              >
                <LogOut className="h-5 w-5" />
              </Button>
            </div>

            <LiveClock />

            <div className="flex items-center justify-center gap-3">
              <div className={`h-3 w-3 rounded-full shadow-lg ${
                isClockedIn ? "bg-green-400 animate-pulse shadow-green-400/50" :
                isOnBreak ? "bg-amber-400 animate-pulse shadow-amber-400/50" :
                "bg-white/40"
              }`} />
              <Badge
                variant={isClockedIn ? "default" : isOnBreak ? "secondary" : "outline"}
                className={`text-sm px-4 py-1 ${
                  isClockedIn ? "bg-emerald-600/80 text-white border-emerald-500/50" :
                  isOnBreak ? "bg-amber-500/80 text-white border-amber-400/50" :
                  "bg-white/10 text-white/80 border-white/30"
                }`}
                data-testid="badge-clock-status"
              >
                {isClockedIn ? "Clocked In" : isOnBreak ? "On Break" : "Clocked Out"}
              </Badge>
              {lastPunch && (
                <span className="text-xs text-white/50">
                  since {new Date(lastPunch.punchTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                </span>
              )}
            </div>

            {!isClockedIn && !isOnBreak && assignedWageGroups.length > 0 && (
              <div className="w-full">
                <Label className="text-xs uppercase tracking-wider text-white/60 mb-1 block">Select Role / Wage Group</Label>
                <Select value={selectedWageGroupId} onValueChange={setSelectedWageGroupId}>
                  <SelectTrigger className="bg-white/10 border-white/30 text-white" data-testid="select-timeclock-wage-group">
                    <SelectValue placeholder="Default rate" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Default Rate (${Number(authenticatedWorker.payRate || 0).toFixed(2)}/hr)</SelectItem>
                    {assignedWageGroups.map(wg => (
                      <SelectItem key={wg.id} value={wg.id}>{wg.name} (${Number(wg.hourlyRate || 0).toFixed(2)}/hr)</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex gap-3">
              {!isClockedIn && !isOnBreak ? (
                <PunchButton
                  type="clock_in"
                  icon={Play}
                  label="Clock In"
                  variant="default"
                  workerId={authenticatedWorker.id}
                  companyId={authenticatedWorker.companyId}
                  wageGroupId={selectedWageGroupId && selectedWageGroupId !== "default" ? selectedWageGroupId : undefined}
                  onSuccess={() => setSelectedWageGroupId("")}
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
          <Card className="bg-white/10 backdrop-blur-xl border-white/20 shadow-2xl">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2 text-white/90">
                <Activity className="h-4 w-4 text-teal-300" />
                Today's Activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                {workerPunches.slice(0, 10).map((punch) => (
                  <div
                    key={punch.id}
                    className="flex items-center justify-between py-2.5 border-b border-white/10 last:border-0"
                    data-testid={`row-punch-${punch.id}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`h-2 w-2 rounded-full ${
                        punch.punchType === "clock_in" ? "bg-green-400" :
                        punch.punchType === "clock_out" ? "bg-red-400" :
                        "bg-amber-400"
                      }`} />
                      <span className="text-sm capitalize text-white/80">
                        {punch.punchType.replace(/_/g, " ")}
                      </span>
                    </div>
                    <span className="text-xs text-white/50 tabular-nums">
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
