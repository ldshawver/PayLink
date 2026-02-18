import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import AttendancePage from "@/pages/attendance";
import SchedulePage from "@/pages/schedule";
import EmployeePage from "@/pages/employee";
import CompanyPage from "@/pages/company";
import PayrollPage from "@/pages/payroll";
import PolicyPage from "@/pages/policy";
import HRPage from "@/pages/hr";
import ReportsPage from "@/pages/reports";
import TimeClock from "@/pages/time-clock";
import PrintCheckPage from "@/pages/print-check";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/time-clock" component={TimeClock} />
      <Route path="/print-check/:runId" component={PrintCheckPage} />
      <Route path="/attendance" component={AttendancePage} />
      <Route path="/schedule" component={SchedulePage} />
      <Route path="/employee" component={EmployeePage} />
      <Route path="/company" component={CompanyPage} />
      <Route path="/payroll" component={PayrollPage} />
      <Route path="/policy" component={PolicyPage} />
      <Route path="/hr" component={HRPage} />
      <Route path="/reports" component={ReportsPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <SidebarProvider style={style as React.CSSProperties}>
            <div className="flex h-screen w-full">
              <AppSidebar />
              <div className="flex flex-col flex-1 overflow-hidden">
                <header className="flex items-center justify-between gap-2 p-2 border-b sticky top-0 z-50 bg-background">
                  <SidebarTrigger data-testid="button-sidebar-toggle" />
                  <ThemeToggle />
                </header>
                <main className="flex-1 overflow-y-auto">
                  <Router />
                </main>
              </div>
            </div>
          </SidebarProvider>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
