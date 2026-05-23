import { useState, useEffect } from "react";
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
  UserCog,
  KeyRound,
  Printer,
  Package,
  Mail,
  LogOut,
  Kanban,
  Megaphone,
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
import paylinkLogo from "@assets/PayLink_Logo_transparent_1771416877301.png";
import { isManagerOrAbove, expandRoleForLegacyGuards } from "@/lib/roles";
import { useFeatureFlags } from "@/lib/featureFlags";

type NavItem = {
  title: string;
  url: string;
  icon: any;
  roles?: string[];
  featureKey?: string;
};

type NavSection = {
  label: string;
  icon: any;
  url: string;
  roles?: string[];
  items: NavItem[];
  featureKey?: string;
};

type NavGroup = {
  groupLabel: string;
  roles?: string[];
  collapsible?: boolean;
  sections: NavSection[];
};

// ─── Tenant App navigation ────────────────────────────────────────────────────

const GROWTH_NAV: NavGroup[] = [
  {
    groupLabel: "Main",
    sections: [
      {
        label: "Dashboard",
        icon: LayoutDashboard,
        url: "/app",
        items: [],
      },
    ],
  },
  {
    groupLabel: "Sales",
    sections: [
      {
        label: "Pipeline",
        icon: Kanban,
        url: "/app/deal-pipeline",
        items: [
          { title: "Deal Pipeline", url: "/app/deal-pipeline", icon: Kanban },
          { title: "Customers", url: "/app/customers?tab=customers", icon: Users },
          { title: "Invoices", url: "/app/invoices?tab=invoices", icon: FileText },
        ],
      },
      {
        label: "Customers",
        icon: Users,
        url: "/app/customers",
        items: [
          { title: "Customer Directory", url: "/app/customers?tab=customers", icon: Users },
          { title: "Vendors", url: "/app/customers?tab=vendors", icon: Building2 },
          { title: "Contractors", url: "/app/customers?tab=contractors", icon: Briefcase },
        ],
      },
      {
        label: "Billing",
        icon: Receipt,
        url: "/app/invoices",
        items: [
          { title: "Invoices", url: "/app/invoices?tab=invoices", icon: FileText },
          { title: "Recurring Billing", url: "/app/invoices?tab=recurring", icon: Repeat },
          { title: "Payments", url: "/app/invoices?tab=payments", icon: DollarSign },
        ],
      },
    ],
  },
  {
    groupLabel: "Marketing",
    sections: [
      {
        label: "Campaigns",
        icon: Megaphone,
        url: "/app/engagement-feed",
        items: [
          { title: "Engagement Feed", url: "/app/engagement-feed", icon: MessageSquare },
          { title: "Customer Segments", url: "/app/customers?tab=customers", icon: UsersRound },
          { title: "Campaign Billing", url: "/app/invoices?tab=recurring", icon: Repeat },
        ],
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
    groupLabel: "Settings",
    roles: ["admin", "system_admin", "platform_super_admin", "platform_admin", "tenant_owner"],
    collapsible: true,
    sections: [
      {
        label: "Settings",
        icon: Settings,
        url: "/app/settings",
        roles: ["admin", "system_admin", "platform_super_admin", "platform_admin", "tenant_owner"],
        items: [
          { title: "Company Policies", url: "/app/settings", icon: Shield },
          { title: "Check Print Calibration", url: "/app/settings#calibration", icon: Printer },
          { title: "KPI Goals", url: "/app/kpi-goals", icon: BarChart3 },
          { title: "SaaS Operations", url: "/app/settings#saas-platform", icon: ServerCog },
          { title: "Platform Console", url: "/platform", icon: ServerCog },
        ],
      },
      {
        label: "Email Settings",
        icon: Mail,
        url: "/app/settings/email",
        roles: ["admin", "system_admin", "platform_super_admin", "platform_admin", "tenant_owner"],
        items: [],
      },
      {
        label: "SMS Settings",
        icon: MessageSquare,
        url: "/app/settings/sms",
        roles: ["admin", "system_admin", "platform_super_admin", "platform_admin", "tenant_owner"],
        items: [],
      },
      {
        label: "Alert Templates",
        icon: Bell,
        url: "/app/notification-templates",
        roles: ["admin", "system_admin", "platform_super_admin", "platform_admin", "tenant_owner"],
        items: [],
      },
      {
        label: "AI App Doctor",
        icon: Code,
        url: "/app/app-doctor",
        roles: ["admin", "system_admin", "platform_super_admin", "platform_admin", "tenant_owner", "tenant_admin"],
        items: [],
      },
      {
        label: "Tenant Permissions",
        icon: UserCog,
        url: "/app/role-management",
        roles: ["admin", "system_admin", "platform_super_admin", "platform_admin", "tenant_owner", "tenant_admin"],
        items: [
          { title: "Role Assignments", url: "/app/role-management?tab=assignments", icon: Users },
          { title: "Custom Roles", url: "/app/role-management?tab=custom-roles", icon: Shield },
          { title: "Permission Overrides", url: "/app/role-management?tab=overrides", icon: KeyRound },
        ],
      },
      {
        label: "Privacy Audit Log",
        icon: ShieldCheck,
        url: "/app/privacy-audit-log",
        roles: ["admin", "system_admin", "platform_super_admin", "platform_admin", "tenant_owner", "tenant_admin"],
        items: [],
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
  const { flags: featureFlags } = useFeatureFlags();

  const search = useSearch();
  const locationPath = location;
  const locationTab = new URLSearchParams(search).get("tab");

  const userRole = user?.role || "employee";
  const isManager = isManagerOrAbove(userRole);

  // Track which collapsible group headers are open (default all open)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  const toggleGroup = (label: string) => {
    setOpenGroups(prev => ({ ...prev, [label]: !(prev[label] ?? true) }));
  };

  const isGroupOpen = (label: string) => openGroups[label] ?? true;

  const hasAccess = (roles?: string[]) => {
    if (!roles || roles.length === 0) return true;
    const effectiveRoles = expandRoleForLegacyGuards(userRole);
    return roles.some(r => effectiveRoles.includes(r));
  };

  const hasFeature = (featureKey?: string) => {
    if (!featureKey) return true;
    if (userRole.startsWith("platform_")) return true;
    if (!featureFlags || !(featureKey in featureFlags)) return true;
    return featureFlags[featureKey] === true;
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
    if (!hasFeature(section.featureKey)) return null;
    const visibleItems = section.items.filter(i => hasAccess(i.roles) && hasFeature(i.featureKey));

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
                {isManager ? "Sales & Marketing" : "Growth Portal"}
              </span>
            </div>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        {GROWTH_NAV.map((group) => {
          if (group.roles && !hasAccess(group.roles)) return null;
          const visibleSections = group.sections.filter(s => hasAccess(s.roles));
          if (visibleSections.length === 0) return null;

          if (group.collapsible) {
            const open = isGroupOpen(group.groupLabel);
            return (
              <SidebarGroup key={group.groupLabel}>
                <button
                  onClick={() => toggleGroup(group.groupLabel)}
                  className="flex items-center w-full px-2 py-1 text-[11px] uppercase tracking-widest text-sidebar-foreground/40 font-semibold hover:text-sidebar-foreground/70 transition-colors group"
                  data-testid={`group-toggle-${group.groupLabel.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <span>{group.groupLabel}</span>
                  <ChevronDown className={`ml-auto h-3.5 w-3.5 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
                </button>
                {open && (
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {visibleSections.map(section => renderSection(section))}
                    </SidebarMenu>
                  </SidebarGroupContent>
                )}
              </SidebarGroup>
            );
          }

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
      </SidebarContent>

      <SidebarFooter className="p-4 space-y-3">
        <LogoutButton />
        <div className="text-xs text-sidebar-foreground/50">PayLink v2.0</div>
      </SidebarFooter>
    </Sidebar>
  );
}
