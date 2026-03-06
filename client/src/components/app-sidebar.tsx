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
  Contact,
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

const navSections = [
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
      { title: "Accruals", url: "/attendance?tab=accruals", icon: CalendarClock },
    ],
  },
  {
    label: "Schedule",
    icon: CalendarDays,
    url: "/schedule",
    items: [
      { title: "Schedules", url: "/schedule?tab=schedules", icon: CalendarDays },
      { title: "Scheduled Shifts", url: "/schedule?tab=shifts", icon: CalendarRange },
      { title: "Recurring Schedule", url: "/schedule?tab=recurring", icon: Repeat },
      { title: "Recurring Templates", url: "/schedule?tab=templates", icon: FileText },
    ],
  },
  {
    label: "Employee",
    icon: Users,
    url: "/employee",
    items: [
      { title: "Employee", url: "/employee?tab=employee", icon: Users },
      { title: "Employee Contacts", url: "/employee?tab=contacts", icon: Contact },
      { title: "Preferences", url: "/employee?tab=preferences", icon: Settings },
      { title: "Wages", url: "/employee?tab=wages", icon: Wallet },
      { title: "Pay Methods", url: "/employee?tab=pay-methods", icon: CreditCard },
      { title: "Titles", url: "/employee?tab=titles", icon: Tag },
      { title: "Employee Groups", url: "/employee?tab=groups", icon: UsersRound },
      { title: "Ethnic Groups", url: "/employee?tab=ethnic-groups", icon: Globe },
      { title: "New Hire Defaults", url: "/employee?tab=new-hire", icon: UserCheck },
    ],
  },
  {
    label: "Company",
    icon: Building2,
    url: "/company",
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
      { title: "Permission Groups", url: "/company?tab=permissions", icon: Shield },
      { title: "Currencies", url: "/company?tab=currencies", icon: Banknote },
      { title: "Import", url: "/company?tab=import", icon: Import },
      { title: "Quick Start", url: "/company?tab=quickstart", icon: Zap },
    ],
  },
  {
    label: "Payroll",
    icon: DollarSign,
    url: "/payroll",
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
    ],
  },
  {
    label: "Policy",
    icon: Shield,
    url: "/policy",
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
    label: "Report",
    icon: BarChart3,
    url: "/reports",
    items: [
      { title: "Saved Reports", url: "/reports?tab=saved", icon: FolderOpen },
      { title: "Employee Reports", url: "/reports?tab=employee", icon: Users },
      { title: "Timesheet Reports", url: "/reports?tab=timesheet", icon: ClipboardList },
      { title: "Payroll Reports", url: "/reports?tab=payroll", icon: DollarSign },
      { title: "Tax Reports", url: "/reports?tab=tax", icon: Calculator },
      { title: "HR Reports", url: "/reports?tab=hr", icon: PieChart },
    ],
  },
];

function LogoutButton() {
  const { user, logout } = useAuth();
  return (
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <span className="text-xs text-sidebar-foreground/70 truncate">
        {user?.username}
      </span>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => logout()}
        data-testid="button-logout"
      >
        <LogOut className="h-4 w-4 mr-1" />
        <span className="text-xs">Logout</span>
      </Button>
    </div>
  );
}

export function AppSidebar() {
  const [location] = useLocation();

  const search = useSearch();
  const locationPath = location;
  const locationTab = new URLSearchParams(search).get("tab");

  const isActive = (url: string) => {
    if (url === "/") return locationPath === "/";
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

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <Link href="/">
          <div className="flex items-center gap-3 cursor-pointer" data-testid="link-logo">
            <img src={paylinkLogo} alt="PayLink" className="h-12 w-12 object-contain" />
            <div className="flex flex-col">
              <span className="text-sm font-semibold tracking-tight">PayLink</span>
              <span className="text-xs text-sidebar-foreground/60">HR & Payroll</span>
            </div>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navSections.map((section) => {
                if (section.items.length === 0) {
                  return (
                    <SidebarMenuItem key={section.label}>
                      <SidebarMenuButton asChild isActive={isActive(section.url)}>
                        <Link href={section.url} data-testid={`link-nav-${section.label.toLowerCase()}`}>
                          <section.icon className="h-4 w-4 text-teal-accent" />
                          <span>{section.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                }

                return (
                  <Collapsible key={section.label} defaultOpen={isActive(section.url)} className="group/collapsible">
                    <SidebarMenuItem>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton isActive={isActive(section.url)} data-testid={`link-nav-${section.label.toLowerCase()}`}>
                          <section.icon className="h-4 w-4 text-teal-accent" />
                          <span>{section.label}</span>
                          <ChevronDown className="ml-auto h-4 w-4 transition-transform group-data-[state=open]/collapsible:rotate-180" />
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <SidebarMenuSub>
                          {section.items.map((item) => (
                            <SidebarMenuSubItem key={item.title}>
                              <SidebarMenuSubButton asChild isActive={isSubItemActive(item.url)}>
                                <Link href={item.url} data-testid={`link-subnav-${item.title.toLowerCase().replace(/[\s/&]/g, "-")}`}>
                                  <span>{item.title}</span>
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
