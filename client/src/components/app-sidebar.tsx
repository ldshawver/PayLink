import { useLocation, useSearch, Link } from "wouter";
import {
  LayoutDashboard,
  Users,
  Clock,
  CalendarDays,
  Building2,
  DollarSign,
  Shield,
  UserCheck,
  FileBarChart,
  ChevronDown,
  Briefcase,
  ClipboardList,
  CalendarClock,
  CalendarCheck,
  Repeat,
  FileText,
  Wallet,
  CreditCard,
  Tag,
  UsersRound,
  Globe,
  Settings,
  Building,
  GitBranch,
  Layers,
  Network,
  Import,
  Zap,
  Calculator,
  Receipt,
  ListOrdered,
  BookOpen,
  Landmark,
  BadgeCheck,
  Code,
  CalendarRange,
  Timer,
  Coffee,
  AlarmClock,
  Award,
  Star,
  GraduationCap,
  Languages,
  IdCard,
  TrendingUp,
  BarChart3,
  PieChart,
  FolderOpen,
  Banknote,
  AlertTriangle,
  UserCircle,
  CalendarOff,
  SlidersHorizontal,
  ShieldCheck,
  HandCoins,
  FilePlus2,
  FolderClosed,
  Workflow,
  Rocket,
  Kanban,
  ClipboardCheck,
  LayoutTemplate,
  Rss,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import paylinkLogo from "@assets/PayLink_Logo_transparent_1771416877301.png";

type NavItem = {
  title: string;
  url: string;
  icon: any;
  roles?: string[];
};

type NavSection = {
  label: string;
  icon: any;
  url: string;
  roles?: string[];
  items: NavItem[];
};

const navSections: NavSection[] = [
  {
    label: "Dashboard",
    icon: LayoutDashboard,
    url: "/",
    items: [],
  },
  {
    label: "Attendance",
    icon: Clock,
    url: "/attendance",
    items: [
      { title: "Timesheet", url: "/attendance?tab=timesheet", icon: ClipboardList },
      { title: "Punches", url: "/attendance?tab=punches", icon: Clock },
      { title: "Accrual Balances", url: "/attendance?tab=accrual-balances", icon: CalendarCheck },
      { title: "Accruals", url: "/attendance?tab=accruals", icon: CalendarClock, roles: ["admin", "manager"] },
      { title: "Pending Approvals", url: "/attendance?tab=pending-approvals", icon: AlertTriangle, roles: ["admin", "manager"] },
      { title: "Time Off", url: "/attendance?tab=time-off", icon: CalendarOff },
      { title: "Schedule Preferences", url: "/attendance?tab=schedule-preferences", icon: SlidersHorizontal },
      { title: "Expenses & Invoices", url: "/expenses", icon: Receipt },
    ],
  },
  {
    label: "Schedule",
    icon: CalendarDays,
    url: "/schedule",
    items: [
      { title: "Schedules", url: "/schedule?tab=schedules", icon: CalendarDays },
      { title: "Scheduled Shifts", url: "/schedule?tab=shifts", icon: CalendarRange },
      { title: "Recurring Schedule", url: "/schedule?tab=recurring", icon: Repeat, roles: ["admin", "manager"] },
      { title: "Recurring Templates", url: "/schedule?tab=templates", icon: FileText, roles: ["admin", "manager"] },
      { title: "Shift Marketplace", url: "/schedule?tab=marketplace", icon: Repeat },
    ],
  },
  {
    label: "Employee",
    icon: Users,
    url: "/employee",
    roles: ["admin", "manager"],
    items: [
      { title: "Employee", url: "/employee?tab=employee", icon: Users },
      { title: "Preferences", url: "/employee?tab=preferences", icon: Settings },
      { title: "Wages", url: "/employee?tab=wages", icon: Wallet },
      { title: "Pay Methods", url: "/employee?tab=pay-methods", icon: CreditCard },
      { title: "Titles", url: "/employee?tab=titles", icon: Tag },
      { title: "Employee Groups", url: "/employee?tab=groups", icon: UsersRound },
      { title: "Ethnic Groups", url: "/employee?tab=ethnic-groups", icon: Globe },
      { title: "Documents", url: "/employee?tab=documents", icon: FileText },
      { title: "New Hire Defaults", url: "/employee?tab=new-hire", icon: UserCheck },
      { title: "User Accounts", url: "/employee?tab=user-accounts", icon: Shield, roles: ["admin"] },
    ],
  },
  {
    label: "Company",
    icon: Building2,
    url: "/company",
    roles: ["admin", "manager"],
    items: [
      { title: "Company Information", url: "/company?tab=info", icon: Building2 },
      { title: "Enterprise", url: "/company?tab=enterprise", icon: Globe },
      { title: "Legal Entity", url: "/company?tab=legal", icon: Briefcase },
      { title: "Divisions", url: "/company?tab=divisions", icon: Layers },
      { title: "Branches", url: "/company?tab=branches", icon: Building },
      { title: "Departments", url: "/company?tab=departments", icon: GitBranch },
      { title: "Positions", url: "/company?tab=positions", icon: BadgeCheck },
      { title: "Cost Centers", url: "/company?tab=cost-centers", icon: Calculator },
      { title: "Jobs", url: "/company?tab=jobs", icon: Briefcase },
      { title: "Hierarchy", url: "/company?tab=hierarchy", icon: Network },
      { title: "Secondary Wage Groups", url: "/company?tab=wage-groups", icon: Layers },
      { title: "Stations", url: "/company?tab=stations", icon: Landmark },
      { title: "Permission Groups", url: "/company?tab=permissions", icon: Shield, roles: ["admin"] },
      { title: "Currencies", url: "/company?tab=currencies", icon: Banknote },
      { title: "Import", url: "/company?tab=import", icon: Import, roles: ["admin"] },
      { title: "Quick Start", url: "/company?tab=quickstart", icon: Zap, roles: ["admin"] },
    ],
  },
  {
    label: "Company Documents",
    icon: FolderClosed,
    url: "/company-documents",
    roles: ["admin", "manager"],
    items: [
      { title: "All Documents", url: "/company-documents?tab=documents", icon: FileText },
      { title: "Collections", url: "/company-documents?tab=collections", icon: FolderOpen },
      { title: "Onboarding", url: "/company-documents?tab=onboarding", icon: UserCheck },
      { title: "Invoice Approval", url: "/company-documents?tab=invoice-approval", icon: Receipt },
      { title: "Retention Policies", url: "/company-documents?tab=retention", icon: Shield },
      { title: "Audit Log", url: "/company-documents?tab=audit", icon: ShieldCheck },
    ],
  },
  {
    label: "Payroll",
    icon: DollarSign,
    url: "/payroll",
    roles: ["admin", "manager"],
    items: [
      { title: "Process Payroll", url: "/payroll?tab=process", icon: DollarSign },
      { title: "Tax Wizard", url: "/payroll?tab=tax-wizard", icon: Calculator },
      { title: "Pay Stubs", url: "/payroll?tab=pay-stubs", icon: Receipt },
      { title: "Pay Stub Transactions", url: "/payroll?tab=transactions", icon: ListOrdered },
      { title: "Pay Periods", url: "/payroll?tab=pay-periods", icon: CalendarRange },
      { title: "Pay Stub Amendments", url: "/payroll?tab=amendments", icon: FileText },
      { title: "Pay Period Schedules", url: "/payroll?tab=period-schedules", icon: CalendarClock },
      { title: "Pay Stub Accounts", url: "/payroll?tab=accounts", icon: BookOpen },
      { title: "Taxes & Deductions", url: "/payroll?tab=taxes-deductions", icon: Landmark },
      { title: "Remittance Agencies", url: "/payroll?tab=remittance-agencies", icon: Building },
      { title: "Remittance Sources", url: "/payroll?tab=remittance-sources", icon: Globe },
      { title: "Expenses & Invoices", url: "/expenses", icon: Receipt },
      { title: "Payroll Audit", url: "/payroll-audit", icon: ShieldCheck },
    ],
  },
  {
    label: "Policy",
    icon: Shield,
    url: "/policy",
    roles: ["admin"],
    items: [
      { title: "Policy Groups", url: "/policy?tab=groups", icon: Shield },
      { title: "Pay Codes", url: "/policy?tab=pay-codes", icon: Code },
      { title: "Pay Formulas", url: "/policy?tab=pay-formulas", icon: Calculator },
      { title: "Contributing Pay Codes", url: "/policy?tab=contributing-pay", icon: Tag },
      { title: "Contributing Shifts", url: "/policy?tab=contributing-shifts", icon: CalendarDays },
      { title: "Accrual Accounts", url: "/policy?tab=accrual-accounts", icon: CalendarCheck },
      { title: "Recurring Holidays", url: "/policy?tab=holidays", icon: CalendarRange },
      { title: "Schedule Policies", url: "/policy?tab=schedule", icon: CalendarClock },
      { title: "Rounding Policies", url: "/policy?tab=rounding", icon: Timer },
      { title: "Meal Policies", url: "/policy?tab=meal", icon: Coffee },
      { title: "Break Policies", url: "/policy?tab=break", icon: AlarmClock },
      { title: "Regular Time Policies", url: "/policy?tab=regular-time", icon: Clock },
      { title: "Overtime Policies", url: "/policy?tab=overtime", icon: TrendingUp },
      { title: "Premium Policies", url: "/policy?tab=premium", icon: Star },
      { title: "Exception Policies", url: "/policy?tab=exception", icon: FileBarChart },
      { title: "Accrual Policies", url: "/policy?tab=accrual", icon: CalendarCheck },
      { title: "Absence Policies", url: "/policy?tab=absence", icon: UserCheck },
      { title: "Holiday Policies", url: "/policy?tab=holiday", icon: CalendarRange },
    ],
  },
  {
    label: "HR",
    icon: BadgeCheck,
    url: "/hr",
    roles: ["admin", "manager"],
    items: [
      { title: "Reviews", url: "/hr?tab=reviews", icon: Star },
      { title: "KPI Groups", url: "/hr?tab=kpi-groups", icon: TrendingUp },
      { title: "Qualifications", url: "/hr?tab=qualifications", icon: BadgeCheck },
      { title: "Qualification Groups", url: "/hr?tab=qual-groups", icon: Award },
      { title: "Skills", url: "/hr?tab=skills", icon: Zap },
      { title: "Education", url: "/hr?tab=education", icon: GraduationCap },
      { title: "Memberships", url: "/hr?tab=memberships", icon: IdCard },
      { title: "Licenses", url: "/hr?tab=licenses", icon: BadgeCheck },
      { title: "Languages", url: "/hr?tab=languages", icon: Languages },
    ],
  },
  {
    label: "Customers & Vendors",
    icon: HandCoins,
    url: "/customers",
    roles: ["admin", "manager"],
    items: [
      { title: "Directory", url: "/customers", icon: Users },
    ],
  },
  {
    label: "Onboarding Hub",
    icon: Rocket,
    url: "/deal-pipeline",
    roles: ["admin", "manager"],
    items: [
      { title: "Deal Pipeline", url: "/deal-pipeline", icon: Kanban },
      { title: "Onboarding Projects", url: "/onboarding-projects", icon: ClipboardCheck },
      { title: "Templates", url: "/onboarding-templates", icon: LayoutTemplate },
      { title: "Engagement Feed", url: "/engagement-feed", icon: Rss },
    ],
  },
  {
    label: "Invoicing",
    icon: FilePlus2,
    url: "/invoices",
    roles: ["admin", "manager"],
    items: [
      { title: "Invoices", url: "/invoices?tab=invoices", icon: FileText },
      { title: "Recurring Billing", url: "/invoices?tab=recurring", icon: Repeat },
      { title: "Payments", url: "/invoices?tab=payments", icon: DollarSign },
    ],
  },
  {
    label: "Report",
    icon: BarChart3,
    url: "/reports",
    roles: ["admin", "manager"],
    items: [
      { title: "Saved Reports", url: "/reports?tab=saved", icon: FolderOpen },
      { title: "Employee Reports", url: "/reports?tab=employee", icon: Users },
      { title: "Timesheet Reports", url: "/reports?tab=timesheet", icon: ClipboardList },
      { title: "Payroll Reports", url: "/reports?tab=payroll", icon: DollarSign },
      { title: "Tax Reports", url: "/reports?tab=tax", icon: Calculator },
      { title: "HR Reports", url: "/reports?tab=hr", icon: PieChart },
      { title: "Expense Reports", url: "/reports?tab=expense", icon: Receipt },
    ],
  },
  {
    label: "Billing",
    icon: CreditCard,
    url: "/billing",
    roles: ["admin"],
    items: [],
  },
  {
    label: "My Profile",
    icon: UserCircle,
    url: "/my-profile",
    items: [
      { title: "Preferences", url: "/my-profile?tab=preferences", icon: Settings },
      { title: "Pay Stubs", url: "/my-profile?tab=paystubs", icon: Receipt },
      { title: "Documents", url: "/my-profile?tab=documents", icon: FileText },
      { title: "Reviews", url: "/my-profile?tab=reviews", icon: Star },
      { title: "Qualifications", url: "/my-profile?tab=qualifications", icon: Zap },
      { title: "Languages", url: "/my-profile?tab=languages", icon: Languages },
      { title: "Memberships", url: "/my-profile?tab=memberships", icon: IdCard },
    ],
  },
];

function LogoutButton() {
  const { user, logout } = useAuth();
  return (
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <span className="text-sm text-sidebar-foreground/70 truncate font-medium">
        {user?.username}
      </span>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => logout()}
        className="h-9 px-3"
        data-testid="button-logout"
      >
        <LogOut className="h-4 w-4 mr-2" />
        <span className="text-sm">Logout</span>
      </Button>
    </div>
  );
}

export function AppSidebar() {
  const [location] = useLocation();
  const { user } = useAuth();

  const search = useSearch();
  const locationPath = location;
  const locationTab = new URLSearchParams(search).get("tab");

  const userRole = user?.role || "employee";

  const hasAccess = (roles?: string[]) => {
    if (!roles || roles.length === 0) return true;
    return roles.includes(userRole);
  };

  const visibleSections = navSections
    .filter((section) => hasAccess(section.roles))
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => hasAccess(item.roles)),
    }));

  const isActive = (url: string) => {
    if (url === "/") return locationPath === "/";
    const basePath = url.split("?")[0];
    if (locationPath.startsWith(basePath)) return true;
    const section = visibleSections.find(s => s.url === url);
    if (section && section.items.length > 0) {
      return section.items.some(item => {
        const itemPath = item.url.split("?")[0];
        return locationPath.startsWith(itemPath);
      });
    }
    return false;
  };

  const isSubItemActive = (itemUrl: string) => {
    const itemPath = itemUrl.split("?")[0];
    const itemTab = new URLSearchParams(itemUrl.split("?")[1] || "").get("tab");
    if (locationPath !== itemPath) return false;
    if (!itemTab && !locationTab) return true;
    return itemTab === locationTab;
  };

  return (
    <Sidebar>
      <SidebarHeader className="p-5 pb-4">
        <Link href="/">
          <div className="flex items-center gap-3 cursor-pointer" data-testid="link-logo">
            <img src={paylinkLogo} alt="PayLink" className="h-12 w-12 object-contain" />
            <div className="flex flex-col">
              <span className="text-base font-bold tracking-tight">PayLink</span>
              <span className="text-xs text-sidebar-foreground/60">HR & Payroll</span>
            </div>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleSections.map((section) => {
                if (section.items.length === 0) {
                  return (
                    <SidebarMenuItem key={section.label}>
                      <SidebarMenuButton asChild isActive={isActive(section.url)} size="lg">
                        <Link href={section.url} data-testid={`link-nav-${section.label.toLowerCase()}`}>
                          <section.icon className="h-5 w-5 text-teal-accent" />
                          <span className="text-[15px] font-medium">{section.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                }

                return (
                  <Collapsible key={section.label} defaultOpen={isActive(section.url)} className="group/collapsible">
                    <SidebarMenuItem>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton isActive={isActive(section.url)} size="lg" data-testid={`link-nav-${section.label.toLowerCase()}`}>
                          <section.icon className="h-5 w-5 text-teal-accent" />
                          <span className="text-[15px] font-medium">{section.label}</span>
                          <ChevronDown className="ml-auto h-4 w-4 transition-transform group-data-[state=open]/collapsible:rotate-180" />
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <SidebarMenuSub>
                          {section.items.map((item) => (
                            <SidebarMenuSubItem key={item.title}>
                              <SidebarMenuSubButton asChild isActive={isSubItemActive(item.url)} size="md">
                                <Link href={item.url} data-testid={`link-subnav-${item.title.toLowerCase().replace(/[\s/&]/g, "-")}`}>
                                  <item.icon className="h-4 w-4 text-teal-accent/70" />
                                  <span className="text-[14px]">{item.title}</span>
                                </Link>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          ))}
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </SidebarMenuItem>
                  </Collapsible>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-4 space-y-3">
        <LogoutButton />
        <div className="text-xs text-sidebar-foreground/50">
          PayLink v2.0
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
