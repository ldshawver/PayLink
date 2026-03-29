import { useState, useEffect, useRef } from "react";
import { Play, Square, LogIn, X, Hash, Lock, CheckCircle, Fingerprint } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
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

type ModalMode = "clock-in" | "clock-out" | "sign-in" | null;

interface ClockModalProps {
  mode: ModalMode;
  onClose: () => void;
}

function ClockModal({ mode, onClose }: ClockModalProps) {
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [successName, setSuccessName] = useState("");
  const { toast } = useToast();
  const empRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode) {
      setEmployeeNumber("");
      setPin("");
      setError("");
      setLoading(false);
      setSuccess(false);
      setTimeout(() => empRef.current?.focus(), 100);
    }
  }, [mode]);

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

  async function handleClockIn() {
    if (!employeeNumber || !pin) { setError("Please enter your employee number and PIN."); return; }
    setLoading(true);
    setError("");
    try {
      const data = await callApi("clock-in-session", { employeeNumber, pin });
      const name = data.worker ? `${data.worker.firstName} ${data.worker.lastName}` : "";
      toast({ title: `Clocked in${name ? ` — ${name}` : ""}`, description: "Redirecting to your dashboard..." });
      setTimeout(() => { window.location.href = "/app/dashboard"; }, 1200);
    } catch (err: any) {
      setError(err.message || "Clock in failed");
      setLoading(false);
    }
  }

  async function handleClockOut() {
    if (!employeeNumber || !pin) { setError("Please enter your employee number and PIN."); return; }
    setLoading(true);
    setError("");
    try {
      const data = await callApi("clock-out-session", { employeeNumber, pin });
      const name = data.worker ? `${data.worker.firstName} ${data.worker.lastName}` : "";
      setSuccessName(name);
      setSuccess(true);
      setLoading(false);
      setTimeout(() => { window.location.href = "/clock-in"; }, 3000);
    } catch (err: any) {
      setError(err.message || "Clock out failed");
      setLoading(false);
    }
  }

  async function handleSignIn() {
    if (!employeeNumber || !pin) { setError("Please enter your employee number and PIN."); return; }
    setLoading(true);
    setError("");
    try {
      await callApi("sign-in", { employeeNumber, pin });
      toast({ title: "Signed in", description: "Redirecting to your dashboard..." });
      setTimeout(() => { window.location.href = "/app/dashboard"; }, 1200);
    } catch (err: any) {
      setError(err.message || "Sign in failed");
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      if (mode === "clock-in") handleClockIn();
      else if (mode === "clock-out") handleClockOut();
      else if (mode === "sign-in") handleSignIn();
    }
  }

  const titles: Record<NonNullable<ModalMode>, string> = {
    "clock-in": "Clock In",
    "clock-out": "Clock Out",
    "sign-in": "Sign In",
  };

  return (
    <Dialog open={!!mode} onOpenChange={(open) => { if (!open && !loading) onClose(); }}>
      <DialogContent
        className="bg-slate-900/95 backdrop-blur-2xl border-white/20 text-white max-w-sm shadow-2xl"
        data-testid="dialog-clock-modal"
      >
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-white flex items-center gap-2">
            {mode === "clock-in" && <Play className="h-5 w-5 text-emerald-400" />}
            {mode === "clock-out" && <Square className="h-5 w-5 text-red-400" />}
            {mode === "sign-in" && <LogIn className="h-5 w-5 text-teal-400" />}
            {mode && titles[mode]}
          </DialogTitle>
          <DialogDescription className="text-white/50 text-sm">
            Enter your employee number and PIN to continue.
          </DialogDescription>
        </DialogHeader>

        {success ? (
          <div className="flex flex-col items-center gap-4 py-6" data-testid="div-clock-out-success">
            <CheckCircle className="h-14 w-14 text-emerald-400" />
            <div className="text-center">
              <p className="text-lg font-semibold text-white">
                {successName ? `${successName} — Clocked Out` : "Clocked Out"}
              </p>
              <p className="text-sm text-white/60 mt-1">Returning to clock page...</p>
            </div>
          </div>
        ) : (
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
              {mode === "clock-in" && (
                <Button
                  onClick={handleClockIn}
                  disabled={loading}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white border-0 shadow-lg shadow-emerald-900/30 py-5"
                  data-testid="button-modal-clock-in"
                >
                  <Play className="h-4 w-4 mr-2" />
                  {loading ? "Clocking In..." : "Clock In"}
                </Button>
              )}

              {mode === "clock-out" && (
                <Button
                  onClick={handleClockOut}
                  disabled={loading}
                  className="w-full bg-red-600 hover:bg-red-700 text-white border-0 shadow-lg shadow-red-900/30 py-5"
                  data-testid="button-modal-clock-out"
                >
                  <Square className="h-4 w-4 mr-2" />
                  {loading ? "Clocking Out..." : "Clock Out"}
                </Button>
              )}

              {mode === "sign-in" && (
                <Button
                  onClick={handleSignIn}
                  disabled={loading}
                  className="w-full bg-teal-600 hover:bg-teal-700 text-white border-0 shadow-lg shadow-teal-900/30 py-5"
                  data-testid="button-modal-sign-in"
                >
                  <Fingerprint className="h-4 w-4 mr-2" />
                  {loading ? "Signing In..." : "Sign In"}
                </Button>
              )}

              {(mode === "clock-in" || mode === "clock-out") && (
                <Button
                  variant="outline"
                  onClick={handleSignIn}
                  disabled={loading}
                  className="w-full border-white/25 text-white/80 hover:bg-white/10 hover:text-white bg-transparent py-4"
                  data-testid="button-modal-sign-in-instead"
                >
                  <LogIn className="h-4 w-4 mr-2" />
                  Sign In Instead
                </Button>
              )}

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
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function TimeClock() {
  const [modalMode, setModalMode] = useState<ModalMode>(null);

  return (
    <div className="relative flex flex-col items-center justify-center min-h-screen p-4 select-none">
      <VideoBackground />

      <div className="relative z-10 w-full max-w-sm space-y-8">
        <div className="flex flex-col items-center gap-4">
          <img
            src={paylinkLogo}
            alt="PayLink"
            className="h-20 w-20 object-contain drop-shadow-2xl"
            data-testid="img-paylink-logo"
          />
          <h1 className="text-2xl font-bold tracking-tight text-white/90 drop-shadow-lg" data-testid="text-timeclock-title">
            Employee Time Clock
          </h1>
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

          <button
            onClick={() => setModalMode("sign-in")}
            className="w-full text-center text-sm text-white/50 hover:text-white/80 underline underline-offset-4 transition-colors pt-1"
            data-testid="button-open-sign-in"
          >
            <LogIn className="h-3.5 w-3.5 inline mr-1 mb-0.5" />
            Employee Sign In
          </button>
        </div>
      </div>

      <ClockModal mode={modalMode} onClose={() => setModalMode(null)} />
    </div>
  );
}
