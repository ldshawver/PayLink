import { useState, useEffect, useRef, useCallback } from "react";
import { Play, Square, LogIn, X, Hash, Lock, CheckCircle, Coffee, ArrowRight, Sun, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
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
        style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover" }}
        data-testid="video-background"
      >
        <source src={bgVideo} type="video/mp4" />
      </video>
      <div className="absolute inset-0 bg-gradient-to-br from-slate-900/55 via-teal-950/45 to-blue-950/55" />
      <div className="absolute inset-0 bg-black/25" />
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

type ModalMode = "clock-in" | "clock-out" | null;
type ModalStep = "credentials" | "clock-in-choice" | "break-or-start" | "clock-out-choice" | "success";
type SuccessType = "clock-in" | "break-in" | "break-out" | "shift-end" | "sign-in";

interface ClockModalProps {
  mode: ModalMode;
  onClose: () => void;
}

function getMarketingUrl() {
  const host = window.location.hostname;
  if (host === "localhost" || host.includes(".repl.") || host.includes(".replit.") || host.includes(".replit.dev") || host.includes(".repl.co")) {
    return "/clock-in";
  }
  return "https://mypaylink.app";
}

function ClockModal({ mode, onClose }: ClockModalProps) {
  const [step, setStep] = useState<ModalStep>("credentials");
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [successType, setSuccessType] = useState<SuccessType | null>(null);
  const [successName, setSuccessName] = useState("");
  const [countdown, setCountdown] = useState(5);
  const empRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode) {
      setStep("credentials");
      setEmployeeNumber("");
      setPin("");
      setError("");
      setLoading(false);
      setSuccessType(null);
      setCountdown(5);
      setTimeout(() => empRef.current?.focus(), 100);
    }
  }, [mode]);

  useEffect(() => {
    if (!successType) return;
    const redirectTypes: SuccessType[] = ["break-out", "shift-end"];
    const isRedirect = redirectTypes.includes(successType);
    const seconds = isRedirect ? 5 : 8;
    setCountdown(seconds);
    const interval = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(interval);
          if (isRedirect) {
            window.location.href = getMarketingUrl();
          } else {
            onClose();
          }
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [successType, onClose]);

  async function callApi(endpoint: string, body: object) {
    const res = await fetch(`/api/time-clock/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Request failed");
    return data;
  }

  async function doAction(endpoint: string, type: SuccessType) {
    if (!employeeNumber || !pin) { setError("Please enter your employee number and PIN."); return; }
    setLoading(true);
    setError("");
    try {
      const data = await callApi(endpoint, { employeeNumber, pin });
      const name = data.worker ? `${data.worker.firstName} ${data.worker.lastName}` : "";
      setSuccessName(name);
      setSuccessType(type);
      setStep("success");
    } catch (err: any) {
      setError(err.message || "Action failed");
    } finally {
      setLoading(false);
    }
  }

  function handleCredentialsContinue() {
    if (!employeeNumber || !pin) { setError("Please enter your employee number and PIN."); return; }
    setError("");
    if (mode === "clock-in") {
      setStep("clock-in-choice");
    } else {
      setStep("clock-out-choice");
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && step === "credentials") handleCredentialsContinue();
  }

  const isRedirectSuccess = successType === "break-out" || successType === "shift-end";

  return (
    <Dialog open={!!mode} onOpenChange={(open) => { if (!open && !loading) onClose(); }}>
      <DialogContent
        className="bg-slate-900/95 backdrop-blur-2xl border-white/20 text-white max-w-sm shadow-2xl"
        data-testid="dialog-clock-modal"
      >

        {/* ── SUCCESS ── */}
        {step === "success" && successType && (
          <div className="flex flex-col items-center gap-5 py-8" data-testid="div-success">
            <CheckCircle className={`h-16 w-16 ${isRedirectSuccess ? "text-amber-400" : "text-emerald-400"}`} />
            <div className="text-center space-y-2">
              <p className="text-xl font-bold text-white">
                {successType === "clock-in" && (successName ? `Welcome, ${successName}!` : "Clocked In!")}
                {successType === "break-in" && (successName ? `Welcome back, ${successName}!` : "Welcome Back!")}
                {successType === "break-out" && (successName ? `Enjoy your break, ${successName}!` : "Enjoy Your Break!")}
                {successType === "shift-end" && (successName ? `Great work, ${successName}!` : "Great Work!")}
                {successType === "sign-in" && (successName ? `Welcome, ${successName}!` : "Signed In!")}
              </p>
              <p className="text-sm text-white/70">
                {successType === "clock-in" && "You're clocked in. Have a great shift!"}
                {successType === "break-in" && "You're back on the clock. Let's go!"}
                {successType === "break-out" && "Take a well-deserved rest. You've earned it!"}
                {successType === "shift-end" && "Your shift is complete. Have a wonderful rest of your day!"}
                {successType === "sign-in" && "You're signed in to the kiosk."}
              </p>
              {isRedirectSuccess ? (
                <p className="text-xs text-white/50 mt-2">
                  Redirecting in <span className="font-bold text-amber-300">{countdown}</span>s...
                </p>
              ) : (
                <p className="text-xs text-white/50 mt-2">
                  Closing in <span className="font-bold text-teal-300">{countdown}</span>s...
                </p>
              )}
            </div>
            {isRedirectSuccess ? (
              <Button
                onClick={() => { window.location.href = getMarketingUrl(); }}
                className="bg-amber-600 hover:bg-amber-700 text-white border-0"
                data-testid="button-success-go"
              >
                Go Now
              </Button>
            ) : (
              <Button
                onClick={onClose}
                className="bg-emerald-600 hover:bg-emerald-700 text-white border-0"
                data-testid="button-success-done"
              >
                Done
              </Button>
            )}
          </div>
        )}

        {/* ── STEP 1: CREDENTIALS ── */}
        {step === "credentials" && (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl font-semibold text-white flex items-center gap-2">
                {mode === "clock-in" ? <Play className="h-5 w-5 text-emerald-400" /> : <Square className="h-5 w-5 text-red-400" />}
                {mode === "clock-in" ? "Clock In" : "Clock Out"}
              </DialogTitle>
              <DialogDescription className="text-white/50 text-sm">
                Enter your employee number and PIN to continue.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-white/60 flex items-center gap-1.5">
                  <Hash className="h-3.5 w-3.5 text-teal-300" /> Employee Number
                </Label>
                <Input
                  ref={empRef}
                  value={employeeNumber}
                  onChange={(e) => setEmployeeNumber(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Enter employee number"
                  autoComplete="off"
                  inputMode="numeric"
                  disabled={loading}
                  data-testid="input-modal-employee-number"
                  className="bg-white/10 border-white/25 text-white placeholder:text-white/35 focus:border-teal-400 focus:ring-teal-400/30"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-white/60 flex items-center gap-1.5">
                  <Lock className="h-3.5 w-3.5 text-teal-300" /> PIN
                </Label>
                <Input
                  type="password"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Enter PIN"
                  autoComplete="off"
                  inputMode="numeric"
                  disabled={loading}
                  data-testid="input-modal-pin"
                  className="bg-white/10 border-white/25 text-white placeholder:text-white/35 focus:border-teal-400 focus:ring-teal-400/30"
                />
              </div>

              {error && (
                <p className="text-sm text-red-300 text-center font-medium" data-testid="text-modal-error">
                  {error}
                </p>
              )}

              <div className="flex flex-col gap-2 pt-2">
                <Button
                  onClick={handleCredentialsContinue}
                  disabled={loading}
                  className={`w-full text-white border-0 shadow-lg py-5 font-semibold ${mode === "clock-in" ? "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-900/30" : "bg-red-600 hover:bg-red-700 shadow-red-900/30"}`}
                  data-testid="button-modal-continue"
                >
                  <ArrowRight className="h-4 w-4 mr-2" />
                  Continue
                </Button>

                <Button
                  variant="ghost"
                  onClick={onClose}
                  disabled={loading}
                  className="w-full text-white/50 hover:text-white hover:bg-white/10"
                  data-testid="button-modal-cancel"
                >
                  <X className="h-4 w-4 mr-2" />
                  Cancel
                </Button>
              </div>
            </div>
          </>
        )}

        {/* ── STEP 2A: CLOCK-IN CHOICE ── */}
        {step === "clock-in-choice" && (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl font-semibold text-white">
                What would you like to do?
              </DialogTitle>
              <DialogDescription className="text-white/50 text-sm">
                Choose an option below.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-3">
              <button
                onClick={() => setStep("break-or-start")}
                className="w-full text-left rounded-xl border border-emerald-500/40 bg-emerald-600/20 hover:bg-emerald-600/35 transition-colors p-4 group"
                data-testid="button-choose-clock-in"
              >
                <div className="flex items-center gap-3">
                  <Play className="h-6 w-6 text-emerald-400 shrink-0" />
                  <div>
                    <p className="font-semibold text-white text-base">Clock In</p>
                    <p className="text-xs text-white/55 mt-0.5">Start tracking time for your shift</p>
                  </div>
                </div>
              </button>

              <button
                onClick={() => doAction("sign-in", "sign-in")}
                disabled={loading}
                className="w-full text-left rounded-xl border border-teal-500/40 bg-teal-600/20 hover:bg-teal-600/35 transition-colors p-4 group disabled:opacity-50"
                data-testid="button-choose-sign-in"
              >
                <div className="flex items-center gap-3">
                  <LogIn className="h-6 w-6 text-teal-400 shrink-0" />
                  <div>
                    <p className="font-semibold text-white text-base">{loading ? "Signing In..." : "Sign In"}</p>
                    <p className="text-xs text-white/55 mt-0.5">Access the kiosk without clocking in</p>
                  </div>
                </div>
              </button>

              {error && (
                <p className="text-sm text-red-300 text-center font-medium" data-testid="text-modal-error-choice">
                  {error}
                </p>
              )}

              <Button
                variant="ghost"
                onClick={() => { setStep("credentials"); setError(""); }}
                className="w-full text-white/40 hover:text-white hover:bg-white/10 text-sm"
                data-testid="button-back-to-credentials"
              >
                ← Back
              </Button>
            </div>
          </>
        )}

        {/* ── STEP 2B: BACK FROM BREAK OR STARTING? ── */}
        {step === "break-or-start" && (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl font-semibold text-white">
                Just starting or back from a break?
              </DialogTitle>
              <DialogDescription className="text-white/50 text-sm">
                Choose what applies to you.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-3">
              <button
                onClick={() => doAction("clock-in-session", "clock-in")}
                disabled={loading}
                className="w-full text-left rounded-xl border border-emerald-500/40 bg-emerald-600/20 hover:bg-emerald-600/35 transition-colors p-4 disabled:opacity-50"
                data-testid="button-starting-shift"
              >
                <div className="flex items-center gap-3">
                  <Sun className="h-6 w-6 text-emerald-400 shrink-0" />
                  <div>
                    <p className="font-semibold text-white text-base">{loading ? "Clocking In..." : "Starting My Shift"}</p>
                    <p className="text-xs text-white/55 mt-0.5">Clock in for the start of my workday</p>
                  </div>
                </div>
              </button>

              <button
                onClick={() => doAction("break-end", "break-in")}
                disabled={loading}
                className="w-full text-left rounded-xl border border-blue-500/40 bg-blue-600/20 hover:bg-blue-600/35 transition-colors p-4 disabled:opacity-50"
                data-testid="button-back-from-break"
              >
                <div className="flex items-center gap-3">
                  <RefreshCcw className="h-6 w-6 text-blue-400 shrink-0" />
                  <div>
                    <p className="font-semibold text-white text-base">{loading ? "Clocking In..." : "Back from Break"}</p>
                    <p className="text-xs text-white/55 mt-0.5">Return from break and resume the clock</p>
                  </div>
                </div>
              </button>

              {error && (
                <p className="text-sm text-red-300 text-center font-medium" data-testid="text-modal-error-break">
                  {error}
                </p>
              )}

              <Button
                variant="ghost"
                onClick={() => { setStep("clock-in-choice"); setError(""); }}
                className="w-full text-white/40 hover:text-white hover:bg-white/10 text-sm"
                data-testid="button-back-to-choice"
              >
                ← Back
              </Button>
            </div>
          </>
        )}

        {/* ── STEP 2C: CLOCK-OUT CHOICE ── */}
        {step === "clock-out-choice" && (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl font-semibold text-white">
                Taking a break or done for the day?
              </DialogTitle>
              <DialogDescription className="text-white/50 text-sm">
                Choose what applies to you.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-3">
              <button
                onClick={() => doAction("break-start", "break-out")}
                disabled={loading}
                className="w-full text-left rounded-xl border border-amber-500/40 bg-amber-600/20 hover:bg-amber-600/35 transition-colors p-4 disabled:opacity-50"
                data-testid="button-taking-break"
              >
                <div className="flex items-center gap-3">
                  <Coffee className="h-6 w-6 text-amber-400 shrink-0" />
                  <div>
                    <p className="font-semibold text-white text-base">{loading ? "Clocking Out..." : "Taking a Break"}</p>
                    <p className="text-xs text-white/55 mt-0.5">Pause the clock — I'll be back soon</p>
                  </div>
                </div>
              </button>

              <button
                onClick={() => doAction("clock-out-session", "shift-end")}
                disabled={loading}
                className="w-full text-left rounded-xl border border-red-500/40 bg-red-600/20 hover:bg-red-600/35 transition-colors p-4 disabled:opacity-50"
                data-testid="button-done-for-day"
              >
                <div className="flex items-center gap-3">
                  <Square className="h-6 w-6 text-red-400 shrink-0" />
                  <div>
                    <p className="font-semibold text-white text-base">{loading ? "Clocking Out..." : "Done for the Day"}</p>
                    <p className="text-xs text-white/55 mt-0.5">End my shift and clock out</p>
                  </div>
                </div>
              </button>

              {error && (
                <p className="text-sm text-red-300 text-center font-medium" data-testid="text-modal-error-clockout">
                  {error}
                </p>
              )}

              <Button
                variant="ghost"
                onClick={() => { setStep("credentials"); setError(""); }}
                className="w-full text-white/40 hover:text-white hover:bg-white/10 text-sm"
                data-testid="button-back-to-creds"
              >
                ← Back
              </Button>
            </div>
          </>
        )}

      </DialogContent>
    </Dialog>
  );
}

export default function TimeClock() {
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const handleClose = useCallback(() => setModalMode(null), []);

  return (
    <div className="relative flex flex-col items-center justify-start min-h-screen p-6 pt-10 select-none">
      <VideoBackground />

      <div className="relative z-10 w-full max-w-sm space-y-6 bg-black/50 backdrop-blur-sm rounded-2xl px-6 py-8 shadow-2xl ring-1 ring-white/10">
        <div className="flex flex-col items-center gap-3 text-center">
          <img
            src={paylinkLogo}
            alt="PayLink"
            className="h-20 w-20 object-contain drop-shadow-2xl"
            data-testid="img-paylink-logo"
          />
          <h1
            className="text-3xl font-extrabold tracking-tight text-white leading-tight"
            style={{ textShadow: "0 2px 12px rgba(0,0,0,0.9)" }}
            data-testid="text-timeclock-h1"
          >
            One Platform.<br />Total Business Control.
          </h1>
          <h2
            className="text-sm font-medium text-white/90 leading-relaxed max-w-xs"
            style={{ textShadow: "0 1px 6px rgba(0,0,0,0.8)" }}
            data-testid="text-timeclock-h2"
          >
            Manage your team, finances, and operations with powerful, integrated tools built to scale.
          </h2>
        </div>

        <LiveClock />

        <div className="space-y-3">
          <Button
            size="lg"
            onClick={() => setModalMode("clock-in")}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white border-0 shadow-xl shadow-emerald-900/40 py-7 text-lg font-semibold transition-all duration-150 hover:scale-[1.02]"
            data-testid="button-open-clock-in"
          >
            <Play className="h-6 w-6 mr-3" />
            Clock In
          </Button>

          <Button
            size="lg"
            onClick={() => setModalMode("clock-out")}
            className="w-full bg-red-600 hover:bg-red-700 text-white border-0 shadow-xl shadow-red-900/40 py-7 text-lg font-semibold transition-all duration-150 hover:scale-[1.02]"
            data-testid="button-open-clock-out"
          >
            <Square className="h-6 w-6 mr-3" />
            Clock Out
          </Button>
        </div>
      </div>

      <ClockModal mode={modalMode} onClose={handleClose} />
    </div>
  );
}
