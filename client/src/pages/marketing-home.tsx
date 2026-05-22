// =============================================================================
// APPROVED MARKETING PAGE — DO NOT MODIFY WITHOUT ADMIN APPROVAL
// =============================================================================
// This file contains the approved PayLink marketing homepage.
// Protected routes: / (public), /login (separate), /clock-in (separate)
// See: docs/marketing-page-lock.md for the full protection policy.
// =============================================================================

import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Clock, Users, DollarSign, FileText, BarChart3, Shield,
  CheckCircle2, ArrowRight, Menu, X, Building2, CalendarClock,
  Receipt, Briefcase, Globe, Lock,
} from "lucide-react";
import { useState } from "react";

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

export default function MarketingHomePage() {
  const [, setLocation] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-50 flex flex-col">

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
      <section className="relative overflow-hidden bg-gradient-to-br from-[hsl(184,96%,10%)] via-[hsl(184,80%,16%)] to-[hsl(200,70%,22%)] text-white py-24 md:py-36 px-4">
        <div className="absolute -top-24 -right-24 w-96 h-96 bg-white/5 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-16 -left-16 w-72 h-72 bg-white/5 rounded-full blur-2xl pointer-events-none" />

        <div className="relative max-w-4xl mx-auto text-center">
          <Badge className="mb-6 bg-white/10 text-white border-white/20 hover:bg-white/10 text-xs uppercase tracking-widest px-3 py-1">
            HR · Payroll · Time Clock
          </Badge>
          <h1 className="text-4xl md:text-6xl font-extrabold leading-tight tracking-tight mb-6">
            Everything your team needs,<br className="hidden md:block" /> in one place.
          </h1>
          <p className="text-lg md:text-xl text-white/80 max-w-2xl mx-auto mb-10 leading-relaxed">
            PayLink is the all-in-one HR, payroll, and time-tracking platform built for multi-location businesses and teams with contractors and employees alike.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
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
              onClick={() => setLocation("/clock-in")}
              data-testid="button-hero-time-clock"
            >
              <Clock className="mr-2 h-5 w-5" /> Open time clock
            </Button>
          </div>

          <div className="mt-12 flex flex-wrap justify-center gap-2">
            {HIGHLIGHTS.map((h) => (
              <span key={h} className="flex items-center gap-1.5 bg-white/10 rounded-full px-3 py-1 text-sm text-white/90">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 flex-shrink-0" /> {h}
              </span>
            ))}
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
            <button onClick={() => setLocation("/clock-in")} className="hover:text-gray-700 dark:hover:text-white transition-colors" data-testid="link-footer-timeclock">
              Time clock
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
