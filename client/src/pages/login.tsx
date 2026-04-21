import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Worker, Company, TimePunch } from "@shared/schema";
import {
  Lock,
  User,
  Clock,
  Hash,
  Fingerprint,
  Play,
  Square,
  Coffee,
  ArrowRight,
  LogOut,
  Activity,
  KeyRound,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
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
        <span className="text-5xl font-light tracking-tight tabular-nums">
          {time.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}
        </span>
        <span className="text-lg font-light tabular-nums text-muted-foreground">
          {time.getSeconds().toString().padStart(2, "0")}
        </span>
      </div>
      <p className="text-xs text-muted-foreground mt-1 tracking-wide uppercase">
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
    <div className="grid grid-cols-3 gap-2 max-w-[220px] mx-auto">
      {digits.map((d) => (
        <Button
          key={d}
          type="button"
          variant={d === "C" || d === "<" ? "secondary" : "outline"}
          className="text-base font-medium h-10"
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
  employeeNumber,
  pin,
}: {
  type: string;
  icon: any;
  label: string;
  variant: "default" | "destructive" | "secondary";
  workerId: string;
  companyId: string;
  employeeNumber?: string;
  pin?: string;
}) {
  const { toast } = useToast();

  const punchMutation = useMutation({
    mutationFn: async () => {
      const endpoint = employeeNumber && pin ? "/api/time-clock/punch" : "/api/time-punches";
      const body: any = { workerId, companyId, punchType: type };
      if (employeeNumber && pin) {
        body.employeeNumber = employeeNumber;
        body.pin = pin;
      }
      await apiRequest("POST", endpoint, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-punches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-clock/punches"] });
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

function AdminLoginForm() {
  const { login } = useAuth();
  const { toast } = useToast();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryUsername, setRecoveryUsername] = useState("");
  const [recoveryToken, setRecoveryToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [recoveryLoading, setRecoveryLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!username || !password) {
      setError("Please enter both username and password");
      return;
    }
    setLoading(true);
    try {
      await login(username, password);
    } catch {
      setError("Invalid username or password");
    } finally {
      setLoading(false);
    }
  }

  async function handleRecovery(e: React.FormEvent) {
    e.preventDefault();
    if (!recoveryUsername || !recoveryToken || !newPassword) {
      toast({ title: "All fields are required", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "Passwords do not match", variant: "destructive" });
      return;
    }
    if (newPassword.length < 6) {
      toast({ title: "Password must be at least 6 characters", variant: "destructive" });
      return;
    }
    setRecoveryLoading(true);
    try {
      const res = await apiRequest("POST", "/api/auth/recover", {
        username: recoveryUsername,
        recoveryToken,
        newPassword,
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Recovery failed", description: data.message, variant: "destructive" });
      } else {
        toast({ title: "Password reset", description: data.message });
        setShowRecovery(false);
        setUsername(recoveryUsername);
        setRecoveryUsername("");
        setRecoveryToken("");
        setNewPassword("");
        setConfirmPassword("");
      }
    } catch {
      toast({ title: "Recovery failed", description: "Could not connect to server", variant: "destructive" });
    } finally {
      setRecoveryLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="username" className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <User className="h-3.5 w-3.5" /> Username
          </Label>
          <Input
            id="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Enter username"
            autoComplete="username"
            data-testid="input-username"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password" className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <Lock className="h-3.5 w-3.5" /> Password
          </Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password"
            autoComplete="current-password"
            data-testid="input-password"
          />
        </div>

        {error && (
          <p className="text-sm text-destructive text-center" data-testid="text-login-error">
            {error}
          </p>
        )}

        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={loading || !username || !password}
          data-testid="button-login"
        >
          {loading ? "Signing in..." : "Sign In"}
        </Button>
      </form>

      <div className="border-t pt-3">
        <button
          type="button"
          onClick={() => setShowRecovery(!showRecovery)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mx-auto"
          data-testid="button-toggle-recovery"
        >
          <KeyRound className="h-3.5 w-3.5" />
          Forgot your password?
          {showRecovery ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>

        {showRecovery && (
          <form onSubmit={handleRecovery} className="mt-3 space-y-3 p-3 rounded-lg bg-muted/50 border">
            <p className="text-xs text-muted-foreground">
              To reset a password, your server administrator must set a <code className="bg-muted px-1 rounded text-xs">RECOVERY_TOKEN</code> environment variable. Enter that token below along with the username and new password.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="rec-username" className="text-xs text-muted-foreground uppercase tracking-wider">Username</Label>
              <Input
                id="rec-username"
                value={recoveryUsername}
                onChange={(e) => setRecoveryUsername(e.target.value)}
                placeholder="e.g. admin"
                autoComplete="off"
                data-testid="input-recovery-username"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rec-token" className="text-xs text-muted-foreground uppercase tracking-wider">Recovery Token</Label>
              <Input
                id="rec-token"
                value={recoveryToken}
                onChange={(e) => setRecoveryToken(e.target.value)}
                placeholder="Token set by server admin"
                autoComplete="off"
                data-testid="input-recovery-token"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rec-newpw" className="text-xs text-muted-foreground uppercase tracking-wider">New Password</Label>
              <Input
                id="rec-newpw"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Min. 6 characters"
                autoComplete="new-password"
                data-testid="input-recovery-new-password"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rec-confirmpw" className="text-xs text-muted-foreground uppercase tracking-wider">Confirm New Password</Label>
              <Input
                id="rec-confirmpw"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter new password"
                autoComplete="new-password"
                data-testid="input-recovery-confirm-password"
              />
            </div>
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              className="w-full"
              disabled={recoveryLoading || !recoveryUsername || !recoveryToken || !newPassword || !confirmPassword}
              data-testid="button-recovery-submit"
            >
              <KeyRound className="h-3.5 w-3.5 mr-1.5" />
              {recoveryLoading ? "Resetting..." : "Reset Password"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

function EmployeePinLoginForm() {
  const { pinLogin } = useAuth();
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeField, setActiveField] = useState<"empNum" | "pin">("empNum");

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

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    setError("");
    if (!employeeNumber || !pin) {
      setError("Please enter both employee number and PIN");
      return;
    }
    setLoading(true);
    try {
      await pinLogin(employeeNumber, pin);
    } catch {
      setError("Invalid employee number or PIN");
      setPin("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="empNumLogin" className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
          <Hash className="h-3.5 w-3.5" /> Employee Number
        </Label>
        <Input
          id="empNumLogin"
          value={employeeNumber}
          onChange={(e) => setEmployeeNumber(e.target.value)}
          onFocus={() => setActiveField("empNum")}
          placeholder="Enter employee number"
          autoComplete="off"
          data-testid="input-emp-number-login"
          className={activeField === "empNum" ? "ring-2 ring-teal-accent/50 border-teal-accent" : ""}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="pinLogin" className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
          <Lock className="h-3.5 w-3.5" /> PIN
        </Label>
        <Input
          id="pinLogin"
          type="password"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          onFocus={() => setActiveField("pin")}
          placeholder="Enter PIN"
          autoComplete="off"
          data-testid="input-pin-login"
          className={activeField === "pin" ? "ring-2 ring-teal-accent/50 border-teal-accent" : ""}
        />
      </div>

      <NumPad
        onInput={handleNumInput}
        onClear={handleClear}
        onBackspace={handleBackspace}
      />

      {error && (
        <p className="text-sm text-destructive text-center" data-testid="text-pin-login-error">
          {error}
        </p>
      )}

      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={loading || !employeeNumber || !pin}
        data-testid="button-pin-login"
      >
        <Fingerprint className="h-5 w-5 mr-2" />
        {loading ? "Signing in..." : "Sign In"}
      </Button>
    </form>
  );
}

function TimeClockPanel() {
  const { toast } = useToast();
  const [authenticatedWorker, setAuthenticatedWorker] = useState<Worker | null>(null);
  const [authenticatedCompany, setAuthenticatedCompany] = useState<Company | null>(null);
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [pin, setPin] = useState("");
  const [authedEmpNum, setAuthedEmpNum] = useState("");
  const [authedPin, setAuthedPin] = useState("");
  const [activeField, setActiveField] = useState<"empNum" | "pin">("empNum");
  const [authError, setAuthError] = useState("");

  const { data: punches } = useQuery<TimePunch[]>({
    queryKey: ["/api/time-clock/punches", authenticatedWorker ? `?workerId=${authenticatedWorker.id}&employeeNumber=${authedEmpNum}&pin=${authedPin}` : ""],
    enabled: !!authenticatedWorker && !!authedEmpNum && !!authedPin,
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
      setAuthedEmpNum(employeeNumber);
      setAuthedPin(pin);
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
    setAuthedEmpNum("");
    setAuthedPin("");
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

  if (authenticatedWorker) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="text-sm font-semibold text-teal-accent">
                {authenticatedWorker.firstName?.[0]}{authenticatedWorker.lastName?.[0]}
              </span>
            </div>
            <div>
              <h2 className="text-base font-semibold" data-testid="text-worker-name">
                {authenticatedWorker.firstName} {authenticatedWorker.lastName}
              </h2>
              <p className="text-xs text-muted-foreground">
                {authenticatedWorker.jobTitle} {authenticatedCompany && `· ${authenticatedCompany.name}`}
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
              employeeNumber={authedEmpNum}
              pin={authedPin}
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
                  employeeNumber={authedEmpNum}
                  pin={authedPin}
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
                  employeeNumber={authedEmpNum}
                  pin={authedPin}
                />
              )}
              <PunchButton
                type="clock_out"
                icon={Square}
                label="Clock Out"
                variant="destructive"
                workerId={authenticatedWorker.id}
                companyId={authenticatedWorker.companyId}
                employeeNumber={authedEmpNum}
                pin={authedPin}
              />
            </>
          )}
        </div>

        {workerPunches.length > 0 && (
          <div className="border rounded-lg p-3 mt-2">
            <h3 className="text-xs font-semibold flex items-center gap-2 mb-2 text-muted-foreground uppercase tracking-wider">
              <Activity className="h-3.5 w-3.5" />
              Today's Activity
            </h3>
            <div className="space-y-0.5">
              {workerPunches.slice(0, 6).map((punch) => (
                <div
                  key={punch.id}
                  className="flex items-center justify-between py-1.5 border-b last:border-0"
                  data-testid={`row-punch-${punch.id}`}
                >
                  <div className="flex items-center gap-2">
                    <div className={`h-1.5 w-1.5 rounded-full ${
                      punch.punchType === "clock_in" ? "bg-green-500" :
                      punch.punchType === "clock_out" ? "bg-red-500" :
                      "bg-amber-500"
                    }`} />
                    <span className="text-xs capitalize">
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
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <LiveClock />

      <div className="h-px bg-border" />

      <p className="text-sm text-muted-foreground text-center" data-testid="text-clock-instructions">
        Enter your employee number and PIN to clock in or out.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="empNum" className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <Hash className="h-3.5 w-3.5" /> Employee Number
          </Label>
          <Input
            id="empNum"
            inputMode="numeric"
            pattern="[0-9]*"
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
            <Lock className="h-3.5 w-3.5" /> PIN
          </Label>
          <Input
            id="pin"
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
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
          {authMutation.isPending ? "Authenticating..." : "Punch In / Out"}
        </Button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-background via-background to-muted/50 p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-3">
          <img src={paylinkLogo} alt="PayLink" className="h-24 w-24 object-contain" />
          <div className="text-center">
            <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-login-title">
              PayLink
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              HR & Payroll Management
            </p>
          </div>
        </div>

        <Card>
          <CardContent className="p-4 sm:p-6">
            <Tabs defaultValue="employee" className="w-full">
              <TabsList className="grid w-full grid-cols-3 mb-5" data-testid="tabs-login-mode">
                <TabsTrigger value="employee" data-testid="tab-employee-login">
                  <Fingerprint className="h-4 w-4 mr-2" />
                  Employee
                </TabsTrigger>
                <TabsTrigger value="admin" data-testid="tab-admin-login">
                  <User className="h-4 w-4 mr-2" />
                  Manager
                </TabsTrigger>
                <TabsTrigger value="timeclock" data-testid="tab-time-clock">
                  <Clock className="h-4 w-4 mr-2" />
                  Time Clock
                </TabsTrigger>
              </TabsList>

              <TabsContent value="employee">
                <EmployeePinLoginForm />
              </TabsContent>

              <TabsContent value="admin">
                <AdminLoginForm />
              </TabsContent>

              <TabsContent value="timeclock">
                <TimeClockPanel />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
