import { lazy, Suspense, useEffect, useState, useCallback } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { PlatformSidebar } from "@/components/platform-sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { ClockInButton } from "@/components/clock-in-button";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { Loader2, Menu } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSidebar } from "@/components/ui/sidebar";
import { useTrial } from "@/hooks/use-trial";
import { TrialBanner } from "@/components/trial-banner";
import { UpgradeModal } from "@/components/upgrade-modal";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { useBiometricAuth } from "@/hooks/use-biometric-auth";
import { useKeyboardManager, usePageTransition, useAppLifecycle } from "@/hooks/use-native-platform";
import { canAccessPlatformConsole } from "@/lib/roles";
import { AccountBlocked } from "@/components/account-blocked";

// ─── Lazy page imports (code-split by route) ──────────────────────────────────
const NotFound = lazy(() => import("@/pages/not-found"));
const OnboardingWizard = lazy(() => import("@/pages/onboarding"));
const Dashboard = lazy(() => import("@/pages/dashboard"));
const AttendancePage = lazy(() => import("@/pages/attendance"));
const SchedulePage = lazy(() => import("@/pages/schedule"));
const EmployeePage = lazy(() => import("@/pages/employee"));
const CompanyPage = lazy(() => import("@/pages/company"));
const PayrollPage = lazy(() => import("@/pages/payroll"));
const PolicyPage = lazy(() => import("@/pages/policy"));
const HRPage = lazy(() => import("@/pages/hr"));
const ReportsPage = lazy(() => import("@/pages/reports"));
const ExpensesPage = lazy(() => import("@/pages/expenses"));
const TimeClock = lazy(() => import("@/pages/time-clock"));
const PrintCheckPage = lazy(() => import("@/pages/print-check"));
const PrintExpenseCheckPage = lazy(() => import("@/pages/print-expense-check"));
const MyProfilePage = lazy(() => import("@/pages/my-profile"));
const PayrollAuditPage = lazy(() => import("@/pages/payroll-audit"));
const CustomersPage = lazy(() => import("@/pages/customers"));
const InvoicesPage = lazy(() => import("@/pages/invoices"));
const PayInvoicePage = lazy(() => import("@/pages/pay-invoice"));
const BillingPage = lazy(() => import("@/pages/billing"));
const CompanyDocumentsPage = lazy(() => import("@/pages/company-documents"));
const DealPipelinePage = lazy(() => import("@/pages/deal-pipeline"));
const OnboardingProjectsPage = lazy(() => import("@/pages/onboarding-projects"));
const OnboardingTemplatesPage = lazy(() => import("@/pages/onboarding-templates"));
const EngagementFeedPage = lazy(() => import("@/pages/engagement-feed"));
const LicenseRequestsPage = lazy(() => import("@/pages/license-requests"));
const PortalOnboardingPage = lazy(() => import("@/pages/portal-onboarding"));
const LoginPage = lazy(() => import("@/pages/login"));
const NotificationSettingsPage = lazy(() => import("@/pages/notification-settings"));
const NotificationTemplatesPage = lazy(() => import("@/pages/notification-templates"));
const MessagesPage = lazy(() => import("@/pages/messages"));
const TradeCompensationPage = lazy(() => import("@/pages/trade-compensation"));
const AgreementsPage = lazy(() => import("@/pages/agreements"));
const OnboardingAdminPage = lazy(() => import("@/pages/onboarding-admin"));
const OnboardingPortalPage = lazy(() => import("@/pages/onboarding-portal"));
const PermissionsPage = lazy(() => import("@/pages/permissions"));
const ProvisioningPage = lazy(() => import("@/pages/provisioning"));
const AuditLogPage = lazy(() => import("@/pages/audit-log"));
const BizDocsPage = lazy(() => import("@/pages/biz-docs"));
const ContractorHubPage = lazy(() => import("@/pages/contractor-hub"));
const TreasuryPage = lazy(() => import("@/pages/treasury"));
const SettingsPage = lazy(() => import("@/pages/settings"));
const PlatformHomePage = lazy(() => import("@/pages/platform-home"));
const FeatureRegistryPage = lazy(() => import("@/pages/feature-registry"));
const RoleManagementPage = lazy(() => import("@/pages/role-management"));
const PlatformAuditPage = lazy(() => import("@/pages/platform-audit"));
const InventoryPage = lazy(() => import("@/pages/inventory"));
const KpiGoalsPage = lazy(() => import("@/pages/kpi-goals"));
const EmailSettingsPage = lazy(() => import("@/pages/email-settings"));
const SmsSettingsPage = lazy(() => import("@/pages/sms-settings"));

// ─── Shared page-loading fallback ────────────────────────────────────────────
function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

// Client-side role expansion — maps new explicit role names to legacy aliases for RoleGuard
const ADMIN_ROLE_ALIASES = new Set([
  "admin", "system_admin", "platform_super_admin", "platform_admin", "platform_support", "platform_implementation",
  "tenant_owner", "tenant_admin", "tenant_hr_admin", "tenant_payroll_admin", "tenant_finance_admin",
]);
const MANAGER_ROLE_ALIASES = new Set([
  ...Array.from(ADMIN_ROLE_ALIASES),
  "manager", "supervisor", "tenant_manager", "tenant_supervisor",
]);

function expandRoles(role: string): string[] {
  const out: string[] = [role];
  if (ADMIN_ROLE_ALIASES.has(role)) out.push("admin");
  if (MANAGER_ROLE_ALIASES.has(role)) out.push("manager");
  return out;
}

function AccessDenied() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center p-6">
      <div className="h-14 w-14 rounded-full bg-destructive/10 flex items-center justify-center">
        <span className="text-2xl text-destructive font-bold">403</span>
      </div>
      <h2 className="text-xl font-semibold">Access Denied</h2>
      <p className="text-muted-foreground max-w-sm text-sm">
        You don't have permission to view this page. Contact your administrator if you believe this is an error.
      </p>
    </div>
  );
}

function RoleGuard({ roles, children }: { roles: string[]; children: React.ReactNode }) {
  const { user } = useAuth();
  const userRole = user?.role || "employee";
  const expanded = expandRoles(userRole);
  const allowed = roles.some(r => expanded.includes(r));

  if (!allowed) return <AccessDenied />;
  return <>{children}</>;
}

function StrictRoleGuard({ roles, children }: { roles: string[]; children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  if (isLoading || !user) return null;
  if (!roles.includes(user.role)) return <AccessDenied />;
  return <>{children}</>;
}

function AuthenticatedRouter() {
  return (
    <Suspense fallback={<PageLoader />}>
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
        <Route path="/app/billing">{() => <PlatformRedirect to="/platform/billing" />}</Route>
        {/* Platform-owner routes — redirect to /platform/* */}
        <Route path="/app/deal-pipeline">{() => <PlatformRedirect to="/platform/deal-pipeline" />}</Route>
        <Route path="/app/onboarding-projects">{() => <PlatformRedirect to="/platform/onboarding-projects" />}</Route>
        <Route path="/app/onboarding-templates">{() => <PlatformRedirect to="/platform/onboarding-templates" />}</Route>
        <Route path="/app/engagement-feed">{() => <PlatformRedirect to="/platform/engagement-feed" />}</Route>
        <Route path="/app/license-requests">{() => <PlatformRedirect to="/platform/license-requests" />}</Route>
        <Route path="/app/print-check/:runId">{() => <RoleGuard roles={["admin", "manager"]}><PrintCheckPage /></RoleGuard>}</Route>
        <Route path="/app/print-expense-check" component={PrintExpenseCheckPage} />
        <Route path="/app/my-profile" component={MyProfilePage} />
        <Route path="/app/notification-settings" component={NotificationSettingsPage} />
        <Route path="/app/notification-templates" component={NotificationTemplatesPage} />
        <Route path="/app/messages" component={MessagesPage} />
        <Route path="/app/trade-compensation">{() => <RoleGuard roles={["admin", "manager"]}><TradeCompensationPage /></RoleGuard>}</Route>
        <Route path="/app/inventory" component={InventoryPage} />
        <Route path="/app/agreements">{() => <PlatformRedirect to="/platform/agreements" />}</Route>
        <Route path="/app/contractor-onboarding">{() => <PlatformRedirect to="/platform/contractor-onboarding" />}</Route>
        <Route path="/app/permissions">{() => <PlatformRedirect to="/platform/permissions" />}</Route>
        <Route path="/app/provisioning">{() => <PlatformRedirect to="/platform/provisioning" />}</Route>
        <Route path="/app/audit-log">{() => <PlatformRedirect to="/platform/audit-log" />}</Route>
        <Route path="/app/biz-docs" component={BizDocsPage} />
        <Route path="/app/contractor-hub" component={ContractorHubPage} />
        <Route path="/app/treasury">{() => <RoleGuard roles={["admin"]}><TreasuryPage /></RoleGuard>}</Route>
        <Route path="/app/settings">{() => <RoleGuard roles={["admin"]}><SettingsPage /></RoleGuard>}</Route>
        <Route path="/app/settings/email">{() => <StrictRoleGuard roles={["admin", "system_admin", "platform_super_admin", "platform_admin", "tenant_owner"]}><EmailSettingsPage /></StrictRoleGuard>}</Route>
        <Route path="/app/settings/sms">{() => <StrictRoleGuard roles={["admin", "system_admin", "platform_super_admin", "platform_admin", "tenant_owner"]}><SmsSettingsPage /></StrictRoleGuard>}</Route>
        <Route path="/app/role-management">{() => <StrictRoleGuard roles={["admin", "system_admin", "platform_super_admin", "platform_admin", "tenant_owner", "tenant_admin"]}><RoleManagementPage /></StrictRoleGuard>}</Route>
        <Route path="/app/kpi-goals">{() => <RoleGuard roles={["admin", "manager"]}><KpiGoalsPage /></RoleGuard>}</Route>
        <Route component={NotFound} />
      </Switch>
    </Suspense>
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

// ─── Platform Console Router & Layout ────────────────────────────────────────

function PlatformRoleGuard({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const allowed = canAccessPlatformConsole(user?.role, user?.companyId);
  if (!allowed) {
    setTimeout(() => setLocation("/app"), 0);
    return null;
  }
  return <>{children}</>;
}

function PlatformRouter() {
  return (
    <PlatformRoleGuard>
      <Suspense fallback={<PageLoader />}>
        <Switch>
          <Route path="/platform" component={PlatformHomePage} />
          <Route path="/platform/deal-pipeline" component={DealPipelinePage} />
          <Route path="/platform/license-requests" component={LicenseRequestsPage} />
          <Route path="/platform/agreements" component={AgreementsPage} />
          <Route path="/platform/onboarding-projects" component={OnboardingProjectsPage} />
          <Route path="/platform/onboarding-templates" component={OnboardingTemplatesPage} />
          <Route path="/platform/engagement-feed" component={EngagementFeedPage} />
          <Route path="/platform/contractor-onboarding" component={OnboardingAdminPage} />
          <Route path="/platform/provisioning" component={ProvisioningPage} />
          <Route path="/platform/permissions" component={PermissionsPage} />
          <Route path="/platform/audit-log" component={AuditLogPage} />
          <Route path="/platform/billing" component={BillingPage} />
          <Route path="/platform/feature-registry" component={FeatureRegistryPage} />
          <Route path="/platform/audit" component={PlatformAuditPage} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </PlatformRoleGuard>
  );
}

function PlatformHeader() {
  const isMobile = useIsMobile();
  const { toggleSidebar } = useSidebar();

  if (!isMobile) {
    return (
      <header className="flex items-center justify-between gap-2 p-2 border-b sticky top-0 z-50 bg-background">
        <SidebarTrigger data-testid="button-platform-sidebar-toggle" />
        <div className="flex items-center gap-3">
          <ThemeToggle />
        </div>
      </header>
    );
  }

  return (
    <header className="flex items-center justify-between gap-2 px-3 py-2 border-b sticky top-0 z-50 bg-gradient-to-r from-slate-900 to-amber-900 text-white shadow-md">
      <button
        onClick={toggleSidebar}
        data-testid="button-platform-sidebar-toggle-mobile"
        className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-white/20 hover:bg-white/30 transition-colors"
      >
        <Menu className="h-6 w-6" />
        <span className="text-sm font-bold">Menu</span>
      </button>
      <span className="text-sm font-bold tracking-wide">Platform Console</span>
      <ThemeToggle />
    </header>
  );
}

function PlatformLayout() {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full overflow-hidden">
        <PlatformSidebar />
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <PlatformHeader />
          <main className="flex-1 overflow-y-auto overflow-x-hidden">
            <PlatformRouter />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

// ─── Old /app/* platform route → /platform/* redirects ───────────────────────

function PlatformRedirect({ to }: { to: string }) {
  const [, setLocation] = useLocation();
  useEffect(() => { setLocation(to); }, [to, setLocation]);
  return <div className="flex items-center justify-center min-h-screen"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
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
    return (
      <Suspense fallback={<PageLoader />}>
        <PortalOnboardingPage />
      </Suspense>
    );
  }

  if (location.startsWith("/onboarding/")) {
    return (
      <Suspense fallback={<PageLoader />}>
        <OnboardingPortalPage />
      </Suspense>
    );
  }

  if (location.startsWith("/pay/")) {
    return (
      <Suspense fallback={<PageLoader />}>
        <PayInvoicePage />
      </Suspense>
    );
  }

  if (location === "/clock-in" || location === "/time-clock") {
    return (
      <Suspense fallback={<PageLoader />}>
        <TimeClock />
      </Suspense>
    );
  }

  if (location === "/login") {
    if (!isLoading && user) {
      return <RedirectToApp />;
    }
    return (
      <BiometricGate>
        <Suspense fallback={<PageLoader />}>
          <LoginPage />
        </Suspense>
      </BiometricGate>
    );
  }

  if (isLoading) {
    return <PageLoader />;
  }

  if (!user) {
    return (
      <BiometricGate>
        <RedirectToLogin />
      </BiometricGate>
    );
  }

  // Tenant gate: block access if subscription/billing is not valid
  // Platform users (no companyId) always pass through
  if (user.companyId && user.tenantGate && !user.tenantGate.allowed) {
    return <AccountBlocked gate={user.tenantGate} />;
  }

  if (location.startsWith("/platform")) {
    return (
      <OnboardingRedirect>
        <NativeFeatureInit />
        <PlatformLayout />
      </OnboardingRedirect>
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
  return <PageLoader />;
}

function RedirectToApp() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    setLocation("/app");
  }, [setLocation]);
  return <PageLoader />;
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
