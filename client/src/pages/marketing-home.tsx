// =============================================================================
// APPROVED MYPAYLINK MARKETING HOMEPAGE — DO NOT MODIFY WITHOUT ADMIN APPROVAL.
// Required hero: time punch card visual with Clock In modal for employee number + PIN.
// Do not replace with login screen or direct clock-in page.
// Protected routes: / (public), /login (separate), /clock-in (separate)
// See: docs/marketing-homepage-lock.md for the full protection policy.
// =============================================================================

import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Clock, Users, DollarSign, FileText, BarChart3, Shield,
  CheckCircle2, ArrowRight, Menu, X, Building2, CalendarClock,
  Receipt, Briefcase, Globe, Lock, LogIn, AlertCircle,
  Sparkles, Loader2,
} from "lucide-react";
import { useState, useEffect } from "react";
import { apiRequest } from "@/lib/queryClient";

const FEATURES = [
  {
    icon: Clock,
    title: "Time & Attendance",
    desc: "Kiosk-style time clock, GPS punch validation, cross-company scheduling, and real-time attendance dashboards.",
  },
  {
    icon: Users,
    title: "Employee Management",
    desc: "Full HR profiles, documents, onboarding workflows, and contractor lifecycle — all in one place.",
  },
  {
    icon: DollarSign,
    title: "Payroll Processing",
    desc: "Multi-step payroll runs with federal & state tax calculations, ACH direct deposit, and tax form generation.",
  },
  {
    icon: CalendarClock,
    title: "Scheduling",
    desc: "Drag-and-drop shift scheduling across multiple locations. Publish once, notify instantly.",
  },
  {
    icon: Receipt,
    title: "Expenses & Invoices",
    desc: "AI receipt scanning, expense approval workflows, customer invoicing, and online payments.",
  },
  {
    icon: FileText,
    title: "Policies & Documents",
    desc: "Policy library with e-signature capture, versioned document storage, and automated retention rules.",
  },
  {
    icon: BarChart3,
    title: "Reports & KPIs",
    desc: "Labour cost analysis, payroll audits, KPI goal tracking, and one-click CSV exports.",
  },
  {
    icon: Shield,
    title: "Compliance & Security",
    desc: "SOC 2-ready audit logs, GDPR PII export/anonymisation, TOTP MFA, and breach-response playbooks.",
  },
];

const HIGHLIGHTS = [
  "Multi-company, single login",
  "Mobile app (iOS & Android)",
  "Role-based access control",
  "ACH direct deposit",
  "Contractor hub & CLM",
  "Free 14-day trial",
];

function LiveClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const dateStr = now.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
  return (
    <div className="text-center">
      <div className="text-4xl font-mono font-bold tracking-tight text-white" data-testid="punch-card-time">
        {timeStr}
      </div>
      <div className="text-sm text-white/70 mt-1">{dateStr}</div>
    </div>
  );
}

function TimePunchCard({ onClockIn }: { onClockIn: () => void }) {
  return (
    <div
      className="relative bg-gradient-to-b from-[hsl(184,60%,14%)] to-[hsl(184,50%,10%)] rounded-2xl border border-white/15 shadow-2xl p-6 w-full max-w-[300px] mx-auto"
      data-testid="time-punch-card"
    >
      <div className="absolute -top-px left-1/2 -translate-x-1/2 w-16 h-1 bg-teal-400/60 rounded-full" />

      <div className="flex items-center gap-2 mb-5">
        <div className="w-7 h-7 rounded-lg bg-teal-500/20 flex items-center justify-center">
          <Clock className="h-4 w-4 text-teal-300" />
        </div>
        <span className="text-white/80 text-sm font-semibold tracking-wide">PayLink Time Clock</span>
      </div>

      <LiveClock />

      <div className="mt-5 space-y-3">
        <div className="rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 flex items-center gap-2 cursor-default select-none">
          <Users className="h-4 w-4 text-white/40 flex-shrink-0" />
          <span className="text-white/40 text-sm">Employee number</span>
        </div>
        <div className="rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 flex items-center gap-2 cursor-default select-none">
          <Lock className="h-4 w-4 text-white/40 flex-shrink-0" />
          <span className="text-white/40 text-sm">PIN</span>
        </div>
      </div>

      <Button
        size="lg"
        className="mt-5 w-full bg-teal-500 hover:bg-teal-400 text-white font-semibold shadow-lg shadow-teal-500/20 border-0"
        onClick={onClockIn}
        data-testid="button-punch-card-clock-in"
      >
        <LogIn className="mr-2 h-4 w-4" /> Clock In
      </Button>

      <p className="text-center text-white/30 text-xs mt-3">
        Employees — tap to punch in or out
      </p>
    </div>
  );
}

function ClockInModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [, setLocation] = useLocation();
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const reset = () => {
    setEmployeeNumber("");
    setPin("");
    setError("");
    setSuccess("");
    setLoading(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleClockIn = async () => {
    setError("");
    if (!employeeNumber.trim()) { setError("Please enter your employee number."); return; }
    if (!pin.trim()) { setError("Please enter your PIN."); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/time-clock/punch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ employeeNumber: employeeNumber.trim(), pin: pin.trim(), punchType: "clock_in" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || "Clock-in failed. Please check your credentials.");
      } else {
        setSuccess(data.message || "Clocked in successfully!");
        setTimeout(() => { handleClose(); setLocation("/clock-in"); }, 1800);
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleClockIn();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="sm:max-w-sm" data-testid="modal-clock-in">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            Employee Clock-In
          </DialogTitle>
          <DialogDescription>
            Enter your employee number and PIN to clock in.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="modal-employee-number">Employee Number</Label>
            <Input
              id="modal-employee-number"
              data-testid="input-modal-employee-number"
              placeholder="e.g. EMP-001"
              value={employeeNumber}
              onChange={(e) => setEmployeeNumber(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="modal-pin">PIN</Label>
            <Input
              id="modal-pin"
              data-testid="input-modal-pin"
              type="password"
              inputMode="numeric"
              placeholder="Enter your PIN"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              onKeyDown={handleKeyDown}
              autoComplete="current-password"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 text-destructive text-sm" data-testid="text-modal-error">
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              {error}
            </div>
          )}
          {success && (
            <div className="flex items-center gap-2 text-emerald-600 text-sm font-medium" data-testid="text-modal-success">
              <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
              {success}
            </div>
          )}

          <Button
            className="w-full"
            onClick={handleClockIn}
            disabled={loading}
            data-testid="button-modal-clock-in"
          >
            {loading ? "Clocking in…" : "Clock In"}
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            Manager?{" "}
            <button
              className="underline hover:text-foreground transition-colors"
              onClick={() => { handleClose(); setLocation("/login"); }}
              data-testid="link-modal-admin-login"
            >
              Log in here
            </button>
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function MarketingHomePage() {
  const [, setLocation] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [clockInOpen, setClockInOpen] = useState(false);
  const [demoPending, setDemoPending] = useState(false);

  const handleLaunchDemo = async () => {
    setDemoPending(true);
    try {
      const res = await apiRequest("POST", "/api/demo/provision", {});
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to start demo");
      setLocation("/app");
    } catch (e: any) {
      alert(e?.message || "Could not start demo. Please try again.");
      setDemoPending(false);
    }
  };

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-50 flex flex-col">

      <ClockInModal open={clockInOpen} onClose={() => setClockInOpen(false)} />

      {/* ── Nav ──────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 bg-white/90 dark:bg-gray-950/90 backdrop-blur border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-xl tracking-tight">
            <Building2 className="h-6 w-6 text-primary" />
            <span className="text-primary">Pay</span><span>Link</span>
          </div>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-gray-600 dark:text-gray-400">
            <a href="#features" className="hover:text-gray-900 dark:hover:text-white transition-colors">Features</a>
            <a href="#why" className="hover:text-gray-900 dark:hover:text-white transition-colors">Why PayLink</a>
          </nav>

          <div className="hidden md:flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setClockInOpen(true)}
              data-testid="button-nav-clock-in"
            >
              <Clock className="mr-1.5 h-4 w-4" /> Clock In
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setLocation("/login")} data-testid="link-nav-login">
              Log in
            </Button>
            <Button size="sm" onClick={() => setLocation("/login")} data-testid="button-nav-get-started">
              Get started free <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </div>

          <button
            className="md:hidden p-2 rounded-md"
            onClick={() => setMobileOpen(!mobileOpen)}
            data-testid="button-mobile-menu"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {mobileOpen && (
          <div className="md:hidden border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 px-4 py-4 flex flex-col gap-3">
            <a href="#features" className="text-sm font-medium py-2" onClick={() => setMobileOpen(false)}>Features</a>
            <a href="#why" className="text-sm font-medium py-2" onClick={() => setMobileOpen(false)}>Why PayLink</a>
            <hr className="border-gray-200 dark:border-gray-800" />
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setMobileOpen(false); setClockInOpen(true); }}
              data-testid="button-mobile-clock-in"
            >
              <Clock className="mr-1.5 h-4 w-4" /> Clock In
            </Button>
            <Button variant="outline" size="sm" onClick={() => setLocation("/login")} data-testid="link-mobile-login">
              Log in
            </Button>
            <Button size="sm" onClick={() => setLocation("/login")} data-testid="button-mobile-get-started">
              Get started free
            </Button>
          </div>
        )}
      </header>

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-[hsl(184,96%,10%)] via-[hsl(184,80%,16%)] to-[hsl(200,70%,22%)] text-white py-20 md:py-28 px-4">
        <div className="absolute -top-24 -right-24 w-96 h-96 bg-white/5 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-16 -left-16 w-72 h-72 bg-white/5 rounded-full blur-2xl pointer-events-none" />

        <div className="relative max-w-6xl mx-auto grid md:grid-cols-2 gap-12 items-center">

          {/* Left: copy + CTAs */}
          <div className="text-center md:text-left">
            <Badge className="mb-6 bg-white/10 text-white border-white/20 hover:bg-white/10 text-xs uppercase tracking-widest px-3 py-1">
              HR · Payroll · Time Clock
            </Badge>
            <h1 className="text-4xl md:text-5xl font-extrabold leading-tight tracking-tight mb-5" data-testid="hero-headline">
              Everything your team needs,{" "}
              <span className="text-teal-300">in one place.</span>
            </h1>
            <p className="text-lg text-white/80 mb-8 leading-relaxed">
              PayLink is the all-in-one HR, payroll, and time-tracking platform built for multi-location businesses and teams with contractors and employees alike.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center md:justify-start">
              <Button
                size="lg"
                className="bg-white text-[hsl(184,96%,19%)] hover:bg-gray-100 font-semibold shadow-lg"
                onClick={() => setLocation("/login")}
                data-testid="button-hero-start-trial"
              >
                Start free trial <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="border-white/40 text-white hover:bg-white/10 font-semibold"
                onClick={handleLaunchDemo}
                disabled={demoPending}
                data-testid="button-hero-launch-demo"
              >
                {demoPending ? (
                  <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Setting up demo…</>
                ) : (
                  <><Sparkles className="mr-2 h-5 w-5" /> Launch Demo</>
                )}
              </Button>
            </div>

            <div className="mt-8 flex flex-wrap justify-center md:justify-start gap-2">
              {HIGHLIGHTS.map((h) => (
                <span key={h} className="flex items-center gap-1.5 bg-white/10 rounded-full px-3 py-1 text-sm text-white/90">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 flex-shrink-0" /> {h}
                </span>
              ))}
            </div>
          </div>

          {/* Right: time punch card visual */}
          <div className="flex justify-center md:justify-end" data-testid="hero-punch-card-section">
            <TimePunchCard onClockIn={() => setClockInOpen(true)} />
          </div>
        </div>
      </section>

      {/* ── Features grid ────────────────────────────────────────────── */}
      <section id="features" className="py-20 px-4 bg-gray-50 dark:bg-gray-900">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Everything HR, payroll, and beyond</h2>
            <p className="text-gray-500 dark:text-gray-400 max-w-xl mx-auto">
              One subscription. No per-module add-ons. Every feature included from day one.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {FEATURES.map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-100 dark:border-gray-700 hover:shadow-md hover:-translate-y-0.5 transition-all"
              >
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="font-semibold mb-2">{title}</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Why PayLink ──────────────────────────────────────────────── */}
      <section id="why" className="py-20 px-4 bg-white dark:bg-gray-950">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Built for growing businesses</h2>
            <p className="text-gray-500 dark:text-gray-400 max-w-xl mx-auto">
              Whether you have 5 employees or 500, PayLink scales with you — without the enterprise price tag.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                icon: Globe,
                title: "Multi-location ready",
                body: "Manage multiple companies, locations, and cost centres from a single platform account. Workers can be scheduled across any location.",
              },
              {
                icon: Briefcase,
                title: "Employees & contractors",
                body: "Full W-2 payroll processing sits alongside contractor onboarding, contract lifecycle management, and 1099 reporting.",
              },
              {
                icon: Lock,
                title: "Compliance by default",
                body: "Audit trails, GDPR data controls, role-based permissions, and SOC 2-aligned security practices are baked in — not bolted on.",
              },
            ].map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex flex-col items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Icon className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-lg mb-1">{title}</h3>
                  <p className="text-gray-500 dark:text-gray-400 text-sm leading-relaxed">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA banner ───────────────────────────────────────────────── */}
      <section className="bg-gradient-to-r from-[hsl(184,96%,14%)] to-[hsl(200,70%,22%)] text-white py-16 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Ready to simplify your HR & payroll?</h2>
          <p className="text-white/80 mb-8 text-lg">Start your free 14-day trial — no credit card required.</p>
          <Button
            size="lg"
            className="bg-white text-[hsl(184,96%,19%)] hover:bg-gray-100 font-semibold shadow-lg"
            onClick={() => setLocation("/login")}
            data-testid="button-cta-start-trial"
          >
            Get started free <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <footer className="bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 py-8 px-4">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-gray-500 dark:text-gray-400">
          <div className="flex items-center gap-2 font-semibold text-gray-700 dark:text-gray-300">
            <Building2 className="h-4 w-4 text-primary" />
            PayLink
          </div>
          <p>© {new Date().getFullYear()} PayLink. All rights reserved.</p>
          <div className="flex items-center gap-4">
            <button onClick={() => setLocation("/login")} className="hover:text-gray-700 dark:hover:text-white transition-colors" data-testid="link-footer-login">
              Log in
            </button>
            <button onClick={() => setClockInOpen(true)} className="hover:text-gray-700 dark:hover:text-white transition-colors" data-testid="link-footer-timeclock">
              Time clock
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
