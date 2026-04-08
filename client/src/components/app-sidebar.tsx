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
  Bell,
  MessageSquare,
  ArrowLeftRight,
  ServerCog,
  ChevronRight,
  Home,
  Stethoscope,
  UserCog,
  KeyRound,
  Printer,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
  SidebarHeader,
  SidebarFooter,
  SidebarSeparator,
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
import { canAccessPlatformConsole, isManagerOrAbove, isTenantAdminRole, expandRoleForLegacyGuards } from "@/lib/roles";

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

type NavGroup = {
  groupLabel: string;
  roles?: string[];
  sections: NavSection[];
};

// ─── Tenant App navigation — organized by functional area ───────────────────

const TENANT_NAV: NavGroup[] = [
  {
    groupLabel: "Main",
    sections: [
      {
        label: "Dashboard",
        icon: LayoutDashboard,
        url: "/app",
        items: [],
      },
      {
        label: "Messages",
        icon: MessageSquare,
        url: "/app/messages",
        items: [],
      },
    ],
  },
  {
    groupLabel: "My Work",
    sections: [
      {
        label: "Attendance",
        icon: Clock,
        url: "/app/attendance",
        items: [
          { title: "Timesheet", url: "/app/attendance?tab=timesheet", icon: ClipboardList },
          { title: "Punches", url: "/app/attendance?tab=punches", icon: Clock },
          { title: "Accrual Balances", url: "/app/attendance?tab=accrual-balances", icon: CalendarCheck },
          { title: "Accruals", url: "/app/attendance?tab=accruals", icon: CalendarClock, roles: ["admin", "manager"] },
          { title: "Pending Approvals", url: "/app/attendance?tab=pending-approvals", icon: AlertTriangle, roles: ["admin", "manager"] },
          { title: "Time Off", url: "/app/attendance?tab=time-off", icon: CalendarOff },
          { title: "Schedule Preferences", url: "/app/attendance?tab=schedule-preferences", icon: SlidersHorizontal },
        ],
      },
      {
        label: "Schedule",
        icon: CalendarDays,
        url: "/app/schedule",
        items: [
          { title: "Schedules", url: "/app/schedule?tab=schedules", icon: CalendarDays },
          { title: "Scheduled Shifts", url: "/app/schedule?tab=shifts", icon: CalendarRange },
          { title: "Recurring Schedule", url: "/app/schedule?tab=recurring", icon: Repeat, roles: ["admin", "manager"] },
          { title: "Recurring Templates", url: "/app/schedule?tab=templates", icon: FileText, roles: ["admin", "manager"] },
          { title: "Shift Marketplace", url: "/app/schedule?tab=marketplace", icon: Repeat },
        ],
      },
      {
        label: "Expenses",
        icon: Receipt,
        url: "/app/expenses",
        items: [
          { title: "My Expenses", url: "/app/expenses?tab=mine", icon: Receipt },
          { title: "Submit Receipt", url: "/app/expenses?tab=submit", icon: FilePlus2 },
        ],
      },
      {
        label: "My Profile",
        icon: UserCircle,
        url: "/app/my-profile",
        items: [
          { title: "Preferences", url: "/app/my-profile?tab=preferences", icon: Settings },
          { title: "Pay Stubs", url: "/app/my-profile?tab=paystubs", icon: Receipt },
          { title: "Documents", url: "/app/my-profile?tab=documents", icon: FileText },
          { title: "Reviews", url: "/app/my-profile?tab=reviews", icon: Star },
          { title: "Qualifications", url: "/app/my-profile?tab=qualifications", icon: Zap },
          { title: "Languages", url: "/app/my-profile?tab=languages", icon: Languages },
          { title: "Memberships", url: "/app/my-profile?tab=memberships", icon: IdCard },
          { title: "Notifications", url: "/app/notification-settings", icon: Bell },
        ],
      },
    ],
  },
  {
    groupLabel: "Workforce",
    roles: ["admin", "manager"],
    sections: [
      {
        label: "Employee",
        icon: Users,
        url: "/app/employee",
        roles: ["admin", "manager"],
        items: [
          { title: "Employee", url: "/app/employee?tab=employee", icon: Users },
          { title: "Preferences", url: "/app/employee?tab=preferences", icon: Settings },
          { title: "Wages", url: "/app/employee?tab=wages", icon: Wallet },
          { title: "Pay Methods", url: "/app/employee?tab=pay-methods", icon: CreditCard },
          { title: "Titles", url: "/app/employee?tab=titles", icon: Tag },
          { title: "Employee Groups", url: "/app/employee?tab=groups", icon: UsersRound },
          { title: "Ethnic Groups", url: "/app/employee?tab=ethnic-groups", icon: Globe },
          { title: "Documents", url: "/app/employee?tab=documents", icon: FileText },
          { title: "New Hire Defaults", url: "/app/employee?tab=new-hire", icon: UserCheck },
          { title: "User Accounts", url: "/app/employee?tab=user-accounts", icon: Shield, roles: ["admin"] },
        ],
      },
    ],
  },
  {
    groupLabel: "HR",
    roles: ["admin", "manager"],
    sections: [
      {
        label: "HR",
        icon: BadgeCheck,
        url: "/app/hr",
        roles: ["admin", "manager"],
        items: [
          { title: "Reviews", url: "/app/hr?tab=reviews", icon: Star },
          { title: "KPI Groups", url: "/app/hr?tab=kpi-groups", icon: TrendingUp },
          { title: "Qualifications", url: "/app/hr?tab=qualifications", icon: BadgeCheck },
          { title: "Qualification Groups", url: "/app/hr?tab=qual-groups", icon: Award },
          { title: "Skills", url: "/app/hr?tab=skills", icon: Zap },
          { title: "Education", url: "/app/hr?tab=education", icon: GraduationCap },
          { title: "Memberships", url: "/app/hr?tab=memberships", icon: IdCard },
          { title: "Licenses", url: "/app/hr?tab=licenses", icon: BadgeCheck },
          { title: "Languages", url: "/app/hr?tab=languages", icon: Languages },
        ],
      },
    ],
  },
  {
    groupLabel: "Payroll",
    roles: ["admin", "manager"],
    sections: [
      {
        label: "Payroll",
        icon: DollarSign,
        url: "/app/payroll",
        roles: ["admin", "manager"],
        items: [
          { title: "Process Payroll", url: "/app/payroll?tab=process", icon: DollarSign },
          { title: "Tax Wizard", url: "/app/payroll?tab=tax-wizard", icon: Calculator },
          { title: "Pay Stubs", url: "/app/payroll?tab=pay-stubs", icon: Receipt },
          { title: "Pay Stub Transactions", url: "/app/payroll?tab=transactions", icon: ListOrdered },
          { title: "Pay Periods", url: "/app/payroll?tab=pay-periods", icon: CalendarRange },
          { title: "Pay Stub Amendments", url: "/app/payroll?tab=amendments", icon: FileText },
          { title: "Pay Period Schedules", url: "/app/payroll?tab=period-schedules", icon: CalendarClock },
          { title: "Pay Stub Accounts", url: "/app/payroll?tab=accounts", icon: BookOpen },
          { title: "Taxes & Deductions", url: "/app/payroll?tab=taxes-deductions", icon: Landmark },
          { title: "Remittance Agencies", url: "/app/payroll?tab=remittance-agencies", icon: Building },
          { title: "Remittance Sources", url: "/app/payroll?tab=remittance-sources", icon: Globe },
          { title: "Payroll Audit", url: "/app/payroll-audit", icon: ShieldCheck },
          { title: "Stripe Treasury", url: "/app/treasury", icon: Landmark },
        ],
      },
    ],
  },
  {
    groupLabel: "Finance",
    roles: ["admin", "manager"],
    sections: [
      {
        label: "Invoicing",
        icon: FilePlus2,
        url: "/app/invoices",
        roles: ["admin", "manager"],
        items: [
          { title: "Invoices", url: "/app/invoices?tab=invoices", icon: FileText },
          { title: "Recurring Billing", url: "/app/invoices?tab=recurring", icon: Repeat },
          { title: "Payments", url: "/app/invoices?tab=payments", icon: DollarSign },
        ],
      },
      {
        label: "Proposals",
        icon: FilePlus2,
        url: "/app/biz-docs",
        roles: ["admin", "manager"],
        items: [
          { title: "Proposals", url: "/app/biz-docs?tab=proposals", icon: FilePlus2 },
          { title: "Business Documents", url: "/app/biz-docs", icon: FileText },
        ],
      },
      {
        label: "Expense Management",
        icon: Receipt,
        url: "/app/expenses",
        roles: ["admin", "manager"],
        items: [
          { title: "All Expenses", url: "/app/expenses", icon: Receipt },
          { title: "Expense Reports", url: "/app/reports?tab=expense", icon: FileBarChart },
        ],
      },
      {
        label: "Contractor Hub",
        icon: Briefcase,
        url: "/app/contractor-hub",
        roles: ["admin"],
        items: [],
      },
      {
        label: "Trade Compensation",
        icon: ArrowLeftRight,
        url: "/app/trade-compensation",
        roles: ["admin", "manager"],
        items: [
          { title: "Transactions", url: "/app/trade-compensation", icon: ArrowLeftRight },
        ],
      },
      {
        label: "Customers & Vendors",
        icon: HandCoins,
        url: "/app/customers",
        roles: ["admin", "manager"],
        items: [
          { title: "Directory", url: "/app/customers", icon: Users },
        ],
      },
    ],
  },
  {
    groupLabel: "Organization",
    roles: ["admin", "manager"],
    sections: [
      {
        label: "Company",
        icon: Building2,
        url: "/app/company",
        roles: ["admin", "manager"],
        items: [
          { title: "Company Information", url: "/app/company?tab=info", icon: Building2 },
          { title: "Legal Entity", url: "/app/company?tab=legal", icon: Briefcase },
          { title: "Divisions", url: "/app/company?tab=divisions", icon: Layers },
          { title: "Branches", url: "/app/company?tab=branches", icon: Building },
          { title: "Departments", url: "/app/company?tab=departments", icon: GitBranch },
          { title: "Positions", url: "/app/company?tab=positions", icon: BadgeCheck },
          { title: "Cost Centers", url: "/app/company?tab=cost-centers", icon: Calculator },
          { title: "Jobs", url: "/app/company?tab=jobs", icon: Briefcase },
          { title: "Hierarchy", url: "/app/company?tab=hierarchy", icon: Network },
          { title: "Secondary Wage Groups", url: "/app/company?tab=wage-groups", icon: Layers },
          { title: "Stations", url: "/app/company?tab=stations", icon: Landmark },
          { title: "Permission Groups", url: "/app/company?tab=permissions", icon: Shield, roles: ["admin"] },
          { title: "Currencies", url: "/app/company?tab=currencies", icon: Banknote },
          { title: "Import", url: "/app/company?tab=import", icon: Import, roles: ["admin"] },
          { title: "Quick Start", url: "/app/company?tab=quickstart", icon: Zap, roles: ["admin"] },
        ],
      },
      {
        label: "Documents & Compliance",
        icon: FolderClosed,
        url: "/app/company-documents",
        roles: ["admin", "manager"],
        items: [
          { title: "All Documents", url: "/app/company-documents?tab=documents", icon: FileText },
          { title: "Collections", url: "/app/company-documents?tab=collections", icon: FolderOpen },
          { title: "Onboarding", url: "/app/company-documents?tab=onboarding", icon: UserCheck },
          { title: "Invoice Approval", url: "/app/company-documents?tab=invoice-approval", icon: Receipt },
          { title: "Retention Policies", url: "/app/company-documents?tab=retention", icon: Shield },
          { title: "Audit Log", url: "/app/company-documents?tab=audit", icon: ShieldCheck },
        ],
      },
    ],
  },
  {
    groupLabel: "Policies & Rules",
    roles: ["admin"],
    sections: [
      {
        label: "Policy",
        icon: Shield,
        url: "/app/policy",
        roles: ["admin"],
        items: [
          { title: "Policy Groups", url: "/app/policy?tab=groups", icon: Shield },
          { title: "Pay Codes", url: "/app/policy?tab=pay-codes", icon: Code },
          { title: "Pay Formulas", url: "/app/policy?tab=pay-formulas", icon: Calculator },
          { title: "Contributing Pay Codes", url: "/app/policy?tab=contributing-pay", icon: Tag },
          { title: "Contributing Shifts", url: "/app/policy?tab=contributing-shifts", icon: CalendarDays },
          { title: "Accrual Accounts", url: "/app/policy?tab=accrual-accounts", icon: CalendarCheck },
          { title: "Recurring Holidays", url: "/app/policy?tab=holidays", icon: CalendarRange },
          { title: "Schedule Policies", url: "/app/policy?tab=schedule", icon: CalendarClock },
          { title: "Rounding Policies", url: "/app/policy?tab=rounding", icon: Timer },
          { title: "Meal Policies", url: "/app/policy?tab=meal", icon: Coffee },
          { title: "Break Policies", url: "/app/policy?tab=break", icon: AlarmClock },
          { title: "Regular Time Policies", url: "/app/policy?tab=regular-time", icon: Clock },
          { title: "Overtime Policies", url: "/app/policy?tab=overtime", icon: TrendingUp },
          { title: "Premium Policies", url: "/app/policy?tab=premium", icon: Star },
          { title: "Exception Policies", url: "/app/policy?tab=exception", icon: FileBarChart },
          { title: "Accrual Policies", url: "/app/policy?tab=accrual", icon: CalendarCheck },
          { title: "Absence Policies", url: "/app/policy?tab=absence", icon: UserCheck },
          { title: "Holiday Policies", url: "/app/policy?tab=holiday", icon: CalendarRange },
        ],
      },
    ],
  },
  {
    groupLabel: "Reports",
    roles: ["admin", "manager"],
    sections: [
      {
        label: "Reports",
        icon: BarChart3,
        url: "/app/reports",
        roles: ["admin", "manager"],
        items: [
          { title: "Saved Reports", url: "/app/reports?tab=saved", icon: FolderOpen },
          { title: "Employee Reports", url: "/app/reports?tab=employee", icon: Users },
          { title: "Timesheet Reports", url: "/app/reports?tab=timesheet", icon: ClipboardList },
          { title: "Payroll Reports", url: "/app/reports?tab=payroll", icon: DollarSign },
          { title: "Tax Reports", url: "/app/reports?tab=tax", icon: Calculator },
          { title: "HR Reports", url: "/app/reports?tab=hr", icon: PieChart },
          { title: "Expense Reports", url: "/app/reports?tab=expense", icon: Receipt },
        ],
      },
    ],
  },
  {
    groupLabel: "System Admin",
    roles: ["admin"],
    sections: [
      {
        label: "Settings",
        icon: Settings,
        url: "/app/settings",
        roles: ["admin"],
        items: [
          { title: "Company Policies", url: "/app/settings", icon: Shield },
          { title: "Check Print Calibration", url: "/app/settings#calibration", icon: Printer },
        ],
      },
      {
        label: "Alert Templates",
        icon: Bell,
        url: "/app/notification-templates",
        roles: ["admin"],
        items: [],
      },
      {
        label: "Tenant Permissions",
        icon: UserCog,
        url: "/app/role-management",
        roles: ["admin"],
        items: [
          { title: "Role Assignments", url: "/app/role-management?tab=assignments", icon: Users },
          { title: "Custom Roles", url: "/app/role-management?tab=custom-roles", icon: Shield },
          { title: "Permission Overrides", url: "/app/role-management?tab=overrides", icon: KeyRound },
        ],
      },
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
  const isPlatformUser = canAccessPlatformConsole(userRole, user?.companyId);
  const isManager = isManagerOrAbove(userRole);

  const hasAccess = (roles?: string[]) => {
    if (!roles || roles.length === 0) return true;
    // Expand the user's actual role to its legacy aliases so that new role names
    // (tenant_admin, tenant_manager, etc.) match against legacy role guards ("admin", "manager")
    const effectiveRoles = expandRoleForLegacyGuards(userRole);
    return roles.some(r => effectiveRoles.includes(r));
  };

  const isActive = (url: string) => {
    if (url === "/app") return locationPath === "/app" || locationPath === "/app/dashboard";
    const basePath = url.split("?")[0];
    return locationPath.startsWith(basePath);
  };

  const isSubItemActive = (itemUrl: string) => {
    const itemPath = itemUrl.split("?")[0];
    const itemTab = new URLSearchParams(itemUrl.split("?")[1] || "").get("tab");
    if (locationPath !== itemPath) return false;
    if (!itemTab && !locationTab) return true;
    return itemTab === locationTab;
  };

  function renderSection(section: NavSection) {
    if (!hasAccess(section.roles)) return null;
    const visibleItems = section.items.filter(i => hasAccess(i.roles));

    if (visibleItems.length === 0) {
      return (
        <SidebarMenuItem key={section.label}>
          <SidebarMenuButton asChild isActive={isActive(section.url)} size="lg">
            <Link href={section.url} data-testid={`link-nav-${section.label.toLowerCase().replace(/[\s&/]+/g, "-")}`}>
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
            <SidebarMenuButton isActive={isActive(section.url)} size="lg" data-testid={`link-nav-${section.label.toLowerCase().replace(/[\s&/]+/g, "-")}`}>
              <section.icon className="h-5 w-5 text-teal-accent" />
              <span className="text-[15px] font-medium">{section.label}</span>
              <ChevronDown className="ml-auto h-4 w-4 transition-transform group-data-[state=open]/collapsible:rotate-180" />
            </SidebarMenuButton>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <SidebarMenuSub>
              {visibleItems.map((item) => (
                <SidebarMenuSubItem key={item.title}>
                  <SidebarMenuSubButton asChild isActive={isSubItemActive(item.url)} size="md">
                    <Link href={item.url} data-testid={`link-subnav-${item.title.toLowerCase().replace(/[\s/&]+/g, "-")}`}>
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
  }

  return (
    <Sidebar>
      <SidebarHeader className="p-5 pb-4">
        <Link href="/app">
          <div className="flex items-center gap-3 cursor-pointer" data-testid="link-logo">
            <img src={paylinkLogo} alt="PayLink" className="h-12 w-12 object-contain" />
            <div className="flex flex-col">
              <span className="text-base font-bold tracking-tight">PayLink</span>
              <span className="text-xs text-sidebar-foreground/60">
                {isManager ? "HR & Payroll" : "Employee Portal"}
              </span>
            </div>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        {TENANT_NAV.map((group) => {
          if (group.roles && !hasAccess(group.roles)) return null;
          const visibleSections = group.sections.filter(s => hasAccess(s.roles));
          if (visibleSections.length === 0) return null;

          return (
            <SidebarGroup key={group.groupLabel}>
              <SidebarGroupLabel className="text-[11px] uppercase tracking-widest text-sidebar-foreground/40 font-semibold px-2 py-1">
                {group.groupLabel}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {visibleSections.map(section => renderSection(section))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}

        {/* Platform Console link — only for platform-scoped users */}
        {isPlatformUser && (
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild size="lg" className="text-amber-500 hover:text-amber-400 hover:bg-amber-500/10">
                    <Link href="/platform" data-testid="link-platform-console">
                      <ServerCog className="h-5 w-5" />
                      <span className="text-[15px] font-medium">Platform Console</span>
                      <ChevronRight className="ml-auto h-4 w-4 opacity-50" />
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="p-4 space-y-3">
        <LogoutButton />
        <div className="text-xs text-sidebar-foreground/50">PayLink v2.0</div>
      </SidebarFooter>
    </Sidebar>
  );
}
