import { useEffect } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { ClockInButton } from "@/components/clock-in-button";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import NotFound from "@/pages/not-found";
import OnboardingWizard from "@/pages/onboarding";
import Dashboard from "@/pages/dashboard";
import AttendancePage from "@/pages/attendance";
import SchedulePage from "@/pages/schedule";
import EmployeePage from "@/pages/employee";
import CompanyPage from "@/pages/company";
import PayrollPage from "@/pages/payroll";
import PolicyPage from "@/pages/policy";
import HRPage from "@/pages/hr";
import ReportsPage from "@/pages/reports";
import ExpensesPage from "@/pages/expenses";
import TimeClock from "@/pages/time-clock";
import PrintCheckPage from "@/pages/print-check";
import PrintExpenseCheckPage from "@/pages/print-expense-check";
import MyProfilePage from "@/pages/my-profile";
import PayrollAuditPage from "@/pages/payroll-audit";
import CustomersPage from "@/pages/customers";
import InvoicesPage from "@/pages/invoices";
import PayInvoicePage from "@/pages/pay-invoice";
import BillingPage from "@/pages/billing";
import CompanyDocumentsPage from "@/pages/company-documents";
import DealPipelinePage from "@/pages/deal-pipeline";
import OnboardingProjectsPage from "@/pages/onboarding-projects";
import OnboardingTemplatesPage from "@/pages/onboarding-templates";
import EngagementFeedPage from "@/pages/engagement-feed";
import LoginPage from "@/pages/login";
import { Loader2, Menu } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSidebar } from "@/components/ui/sidebar";
import { useTrial } from "@/hooks/use-trial";
import { TrialBanner } from "@/components/trial-banner";
import { UpgradeModal } from "@/components/upgrade-modal";

function RoleGuard({ roles, children }: { roles: string[]; children: React.ReactNode }) {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const userRole = user?.role || "employee";
  const allowed = roles.includes(userRole);

  if (!allowed) {
    setTimeout(() => setLocation("/"), 0);
    return null;
  }
  return <>{children}</>;
}

function AuthenticatedRouter() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/onboarding" component={OnboardingWizard} />
      <Route path="/attendance" component={AttendancePage} />
      <Route path="/schedule" component={SchedulePage} />
      <Route path="/employee">{() => <RoleGuard roles={["admin", "manager"]}><EmployeePage /></RoleGuard>}</Route>
      <Route path="/company">{() => <RoleGuard roles={["admin", "manager"]}><CompanyPage /></RoleGuard>}</Route>
      <Route path="/company-documents">{() => <RoleGuard roles={["admin", "manager"]}><CompanyDocumentsPage /></RoleGuard>}</Route>
      <Route path="/payroll">{() => <RoleGuard roles={["admin", "manager"]}><PayrollPage /></RoleGuard>}</Route>
      <Route path="/policy">{() => <RoleGuard roles={["admin"]}><PolicyPage /></RoleGuard>}</Route>
      <Route path="/hr">{() => <RoleGuard roles={["admin", "manager"]}><HRPage /></RoleGuard>}</Route>
      <Route path="/reports">{() => <RoleGuard roles={["admin", "manager"]}><ReportsPage /></RoleGuard>}</Route>
      <Route path="/expenses" component={ExpensesPage} />
      <Route path="/payroll-audit">{() => <RoleGuard roles={["admin", "manager"]}><PayrollAuditPage /></RoleGuard>}</Route>
      <Route path="/customers">{() => <RoleGuard roles={["admin", "manager"]}><CustomersPage /></RoleGuard>}</Route>
      <Route path="/invoices">{() => <RoleGuard roles={["admin", "manager"]}><InvoicesPage /></RoleGuard>}</Route>
      <Route path="/billing">{() => <RoleGuard roles={["admin"]}><BillingPage /></RoleGuard>}</Route>
      <Route path="/deal-pipeline">{() => <RoleGuard roles={["admin", "manager"]}><DealPipelinePage /></RoleGuard>}</Route>
      <Route path="/onboarding-projects">{() => <RoleGuard roles={["admin", "manager"]}><OnboardingProjectsPage /></RoleGuard>}</Route>
      <Route path="/onboarding-templates">{() => <RoleGuard roles={["admin", "manager"]}><OnboardingTemplatesPage /></RoleGuard>}</Route>
      <Route path="/engagement-feed">{() => <RoleGuard roles={["admin", "manager"]}><EngagementFeedPage /></RoleGuard>}</Route>
      <Route path="/print-expense-check" component={PrintExpenseCheckPage} />
      <Route path="/my-profile" component={MyProfilePage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function MobileHeader() {
  const isMobile = useIsMobile();
  const { toggleSidebar } = useSidebar();

  if (!isMobile) {
    return (
      <header className="flex items-center justify-between gap-2 p-2 border-b sticky top-0 z-50 bg-background">
        <SidebarTrigger data-testid="button-sidebar-toggle" />
        <div className="flex items-center gap-3">
          <ClockInButton />
          <ThemeToggle />
        </div>
      </header>
    );
  }

  return (
    <>
      <header className="flex items-center justify-between gap-2 px-3 py-2 border-b sticky top-0 z-50 bg-gradient-to-r from-teal-600 to-blue-600 text-white shadow-md">
        <button
          onClick={toggleSidebar}
          data-testid="button-sidebar-toggle-mobile"
          className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-white/30 hover:bg-white/40 active:bg-white/50 transition-colors border border-white/40 shadow-md"
        >
          <Menu className="h-7 w-7" />
          <span className="text-base font-bold tracking-wide">Menu</span>
        </button>
        <span className="text-sm font-bold tracking-wide">PayLink</span>
        <div className="flex items-center gap-2">
          <ClockInButton />
          <ThemeToggle />
        </div>
      </header>
    </>
  );
}

function AuthenticatedLayout() {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          <TrialBanner />
          <MobileHeader />
          <main className="flex-1 overflow-y-auto">
            <AuthenticatedRouter />
          </main>
          <UpgradeModal />
        </div>
      </div>
    </SidebarProvider>
  );
}

function OnboardingRedirect({ children }: { children: React.ReactNode }) {
  const { isTrial } = useTrial();
  const [location, setLocation] = useLocation();

  const { data: progress, isLoading: progressLoading } = useQuery<any>({
    queryKey: ["/api/onboarding/progress"],
    enabled: isTrial,
    staleTime: 30000,
  });

  useEffect(() => {
    if (!isTrial || progressLoading || !progress) return;
    if (!progress.onboarding_wizard_completed && location !== "/onboarding") {
      setLocation("/onboarding");
    }
  }, [isTrial, progressLoading, progress, location, setLocation]);

  return <>{children}</>;
}

function AppContent() {
  const { user, isLoading } = useAuth();
  const [location] = useLocation();

  if (location.startsWith("/pay/")) {
    return <PayInvoicePage />;
  }

  if (location === "/time-clock") {
    return <TimeClock />;
  }

  if (location.startsWith("/print-check/")) {
    if (isLoading) return null;
    if (!user) return <LoginPage />;
    return <RoleGuard roles={["admin", "manager"]}><PrintCheckPage /></RoleGuard>;
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <OnboardingRedirect>
      <AuthenticatedLayout />
    </OnboardingRedirect>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <AuthProvider>
            <AppContent />
          </AuthProvider>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
