import { useEffect, useState, useCallback } from "react";
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
import LicenseRequestsPage from "@/pages/license-requests";
import PortalOnboardingPage from "@/pages/portal-onboarding";
import LoginPage from "@/pages/login";
import NotificationSettingsPage from "@/pages/notification-settings";
import NotificationTemplatesPage from "@/pages/notification-templates";
import MessagesPage from "@/pages/messages";
import TradeCompensationPage from "@/pages/trade-compensation";
import AgreementsPage from "@/pages/agreements";
import OnboardingAdminPage from "@/pages/onboarding-admin";
import OnboardingPortalPage from "@/pages/onboarding-portal";
import PermissionsPage from "@/pages/permissions";
import ProvisioningPage from "@/pages/provisioning";
import AuditLogPage from "@/pages/audit-log";
import BizDocsPage from "@/pages/biz-docs";
import ContractorHubPage from "@/pages/contractor-hub";
import TreasuryPage from "@/pages/treasury";
import SettingsPage from "@/pages/settings";
import { Loader2, Menu } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSidebar } from "@/components/ui/sidebar";
import { useTrial } from "@/hooks/use-trial";
import { TrialBanner } from "@/components/trial-banner";
import { UpgradeModal } from "@/components/upgrade-modal";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { useBiometricAuth } from "@/hooks/use-biometric-auth";
import { useKeyboardManager, usePageTransition, useAppLifecycle } from "@/hooks/use-native-platform";

function RoleGuard({ roles, children }: { roles: string[]; children: React.ReactNode }) {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const userRole = user?.role || "employee";
  const allowed = roles.includes(userRole);

  if (!allowed) {
    setTimeout(() => setLocation("/app"), 0);
    return null;
  }
  return <>{children}</>;
}

function AuthenticatedRouter() {
  return (
    <Switch>
      <Route path="/app" component={Dashboard} />
      <Route path="/app/dashboard" component={Dashboard} />
      <Route path="/app/onboarding" component={OnboardingWizard} />
      <Route path="/app/attendance" component={AttendancePage} />
      <Route path="/app/schedule" component={SchedulePage} />
      <Route path="/app/employee">{() => <RoleGuard roles={["admin", "manager"]}><EmployeePage /></RoleGuard>}</Route>
      <Route path="/app/company">{() => <RoleGuard roles={["admin", "manager"]}><CompanyPage /></RoleGuard>}</Route>
      <Route path="/app/company-documents">{() => <RoleGuard roles={["admin", "manager"]}><CompanyDocumentsPage /></RoleGuard>}</Route>
      <Route path="/app/payroll">{() => <RoleGuard roles={["admin", "manager"]}><PayrollPage /></RoleGuard>}</Route>
      <Route path="/app/policy">{() => <RoleGuard roles={["admin"]}><PolicyPage /></RoleGuard>}</Route>
      <Route path="/app/hr">{() => <RoleGuard roles={["admin", "manager"]}><HRPage /></RoleGuard>}</Route>
      <Route path="/app/reports">{() => <RoleGuard roles={["admin", "manager"]}><ReportsPage /></RoleGuard>}</Route>
      <Route path="/app/expenses" component={ExpensesPage} />
      <Route path="/app/payroll-audit">{() => <RoleGuard roles={["admin", "manager"]}><PayrollAuditPage /></RoleGuard>}</Route>
      <Route path="/app/customers">{() => <RoleGuard roles={["admin", "manager"]}><CustomersPage /></RoleGuard>}</Route>
      <Route path="/app/invoices">{() => <RoleGuard roles={["admin", "manager"]}><InvoicesPage /></RoleGuard>}</Route>
      <Route path="/app/billing">{() => <RoleGuard roles={["admin"]}><BillingPage /></RoleGuard>}</Route>
      <Route path="/app/deal-pipeline">{() => <RoleGuard roles={["admin", "manager"]}><DealPipelinePage /></RoleGuard>}</Route>
      <Route path="/app/onboarding-projects">{() => <RoleGuard roles={["admin", "manager"]}><OnboardingProjectsPage /></RoleGuard>}</Route>
      <Route path="/app/onboarding-templates">{() => <RoleGuard roles={["admin", "manager"]}><OnboardingTemplatesPage /></RoleGuard>}</Route>
      <Route path="/app/engagement-feed">{() => <RoleGuard roles={["admin", "manager"]}><EngagementFeedPage /></RoleGuard>}</Route>
      <Route path="/app/license-requests">{() => <RoleGuard roles={["admin"]}><LicenseRequestsPage /></RoleGuard>}</Route>
      <Route path="/app/print-check/:runId">{() => <RoleGuard roles={["admin", "manager"]}><PrintCheckPage /></RoleGuard>}</Route>
      <Route path="/app/print-expense-check" component={PrintExpenseCheckPage} />
      <Route path="/app/my-profile" component={MyProfilePage} />
      <Route path="/app/notification-settings" component={NotificationSettingsPage} />
      <Route path="/app/notification-templates" component={NotificationTemplatesPage} />
      <Route path="/app/messages" component={MessagesPage} />
      <Route path="/app/trade-compensation">{() => <RoleGuard roles={["admin", "manager"]}><TradeCompensationPage /></RoleGuard>}</Route>
      <Route path="/app/agreements">{() => <RoleGuard roles={["admin", "manager"]}><AgreementsPage /></RoleGuard>}</Route>
      <Route path="/app/contractor-onboarding">{() => <RoleGuard roles={["admin", "manager"]}><OnboardingAdminPage /></RoleGuard>}</Route>
      <Route path="/app/permissions">{() => <RoleGuard roles={["admin", "platform_super_admin"]}><PermissionsPage /></RoleGuard>}</Route>
      <Route path="/app/provisioning">{() => <RoleGuard roles={["admin"]}><ProvisioningPage /></RoleGuard>}</Route>
      <Route path="/app/audit-log">{() => <RoleGuard roles={["admin", "platform_super_admin"]}><AuditLogPage /></RoleGuard>}</Route>
      <Route path="/app/biz-docs" component={BizDocsPage} />
      <Route path="/app/contractor-hub" component={ContractorHubPage} />
      <Route path="/app/treasury">{() => <RoleGuard roles={["admin"]}><TreasuryPage /></RoleGuard>}</Route>
      <Route path="/app/settings">{() => <RoleGuard roles={["admin"]}><SettingsPage /></RoleGuard>}</Route>
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
  const [location] = useLocation();
  const { containerRef, animateTransition } = usePageTransition();

  useKeyboardManager();

  useEffect(() => {
    animateTransition(location);
  }, [location, animateTransition]);

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full overflow-hidden">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <TrialBanner />
          <MobileHeader />
          <main className="flex-1 overflow-y-auto overflow-x-hidden">
            <div ref={containerRef} className="page-transition-container">
              <AuthenticatedRouter />
            </div>
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
    if (!progress.onboarding_wizard_completed && location !== "/app/onboarding") {
      setLocation("/app/onboarding");
    }
  }, [isTrial, progressLoading, progress, location, setLocation]);

  return <>{children}</>;
}

function NativeFeatureInit() {
  const { user } = useAuth();
  const { setupPushListeners, requestPermission, registerToken, permissionState } = usePushNotifications();
  const [pushRequested, setPushRequested] = useState(false);

  useEffect(() => {
    const cleanup = setupPushListeners();
    return cleanup;
  }, [setupPushListeners]);

  useEffect(() => {
    if (user && permissionState === "granted") {
      registerToken();
    }
  }, [user, permissionState, registerToken]);

  useEffect(() => {
    if (user && !pushRequested && permissionState === "prompt") {
      setPushRequested(true);
      requestPermission().then((granted) => {
        if (granted) registerToken();
      });
    }
  }, [user, pushRequested, permissionState, requestPermission, registerToken]);

  return null;
}

let biometricRestoreAttemptedThisSession = false;

function BiometricGate({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const { isEnabled, isAvailable, restoreSession } = useBiometricAuth();
  const [restoring, setRestoring] = useState(false);

  const runRestore = useCallback(() => {
    if (biometricRestoreAttemptedThisSession) return;
    biometricRestoreAttemptedThisSession = true;
    setRestoring(true);
    restoreSession().finally(() => setRestoring(false));
  }, [restoreSession]);

  useAppLifecycle(useCallback(() => {
    if (!user && isEnabled && isAvailable) {
      biometricRestoreAttemptedThisSession = false;
      runRestore();
    }
  }, [user, isEnabled, isAvailable, runRestore]));

  useEffect(() => {
    if (!isLoading && !user && isEnabled && isAvailable) {
      runRestore();
    }
  }, [isLoading, user, isEnabled, isAvailable, runRestore]);

  if (restoring) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <>{children}</>;
}

function AppContent() {
  const { user, isLoading } = useAuth();
  const [location] = useLocation();

  if (location.startsWith("/portal/onboarding/")) {
    return <PortalOnboardingPage />;
  }

  if (location.startsWith("/onboarding/")) {
    return <OnboardingPortalPage />;
  }

  if (location.startsWith("/pay/")) {
    return <PayInvoicePage />;
  }

  if (location === "/clock-in" || location === "/time-clock") {
    return <TimeClock />;
  }

  if (location === "/login") {
    if (!isLoading && user) {
      return <RedirectToApp />;
    }
    return (
      <BiometricGate>
        <LoginPage />
      </BiometricGate>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return (
      <BiometricGate>
        <RedirectToLogin />
      </BiometricGate>
    );
  }

  return (
    <OnboardingRedirect>
      <NativeFeatureInit />
      <AuthenticatedLayout />
    </OnboardingRedirect>
  );
}

function RedirectToLogin() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    setLocation("/login");
  }, [setLocation]);
  return (
    <div className="flex items-center justify-center min-h-screen">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

function RedirectToApp() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    setLocation("/app");
  }, [setLocation]);
  return (
    <div className="flex items-center justify-center min-h-screen">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
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
