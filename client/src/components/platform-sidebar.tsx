import { useLocation, Link } from "wouter";
import {
  LayoutDashboard,
  FileText,
  ClipboardCheck,
  LayoutTemplate,
  Rss,
  UserCheck,
  ServerCog,
  KeyRound,
  ShieldCheck,
  CreditCard,
  ChevronDown,
  ArrowLeft,
  Grid3X3,
  FileBadge,
  Rocket,
  Building2,
  Layers,
  ToggleLeft,
  Monitor,
  Receipt,
  BarChart3,
  Headphones,
  Activity,
  Banknote,
  ClipboardList,
  FileCheck2,
  Users,
  Bot,
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
import { canAccessPlatformModule, isPlatformRole } from "@/lib/roles";

type PlatformNavItem = {
  title: string;
  url: string;
  icon: any;
};

type PlatformNavSection = {
  label: string;
  icon: any;
  url: string;
  module?: string;
  items: PlatformNavItem[];
};

type PlatformNavGroup = {
  groupLabel: string;
  module?: string;
  sections: PlatformNavSection[];
};

const PLATFORM_NAV: PlatformNavGroup[] = [
  {
    groupLabel: "",
    sections: [
      {
        label: "Console Home",
        icon: LayoutDashboard,
        url: "/platform",
        items: [],
      },
    ],
  },
  {
    groupLabel: "Licensing",
    module: "licensing",
    sections: [
      {
        label: "Licensing",
        icon: FileBadge,
        url: "/platform/license-requests",
        module: "licensing",
        items: [
          { title: "License Requests", url: "/platform/license-requests", icon: FileBadge },
        ],
      },
      {
        label: "Agreements",
        icon: FileCheck2,
        url: "/platform/agreements",
        module: "licensing",
        items: [
          { title: "Templates", url: "/platform/agreements?tab=templates", icon: LayoutTemplate },
          { title: "Signed Agreements", url: "/platform/agreements?tab=agreements", icon: ClipboardCheck },
        ],
      },
    ],
  },
  {
    groupLabel: "Implementation",
    module: "implementation",
    sections: [
      {
        label: "Customer Success",
        icon: Rocket,
        url: "/platform/onboarding-projects",
        module: "implementation",
        items: [
          { title: "Onboarding Projects", url: "/platform/onboarding-projects", icon: ClipboardCheck },
          { title: "Project Templates", url: "/platform/onboarding-templates", icon: LayoutTemplate },
          { title: "Engagement Feed", url: "/platform/engagement-feed", icon: Rss },
          { title: "Contractor Onboarding", url: "/platform/contractor-onboarding", icon: UserCheck },
        ],
      },
    ],
  },
  {
    groupLabel: "Provisioning & Controls",
    module: "provisioning",
    sections: [
      {
        label: "Tenants",
        icon: Building2,
        url: "/platform/tenants",
        module: "provisioning",
        items: [],
      },
      {
        label: "Tenant Provisioning",
        icon: ServerCog,
        url: "/platform/provisioning",
        module: "provisioning",
        items: [
          { title: "Provisioning", url: "/platform/provisioning", icon: ServerCog },
          { title: "Tenant Setup", url: "/platform/provisioning", icon: Building2 },
          { title: "Environment / Demo", url: "/platform/provisioning", icon: ToggleLeft },
        ],
      },
      {
        label: "Platform Permissions",
        icon: ShieldCheck,
        url: "/platform/permissions",
        module: "provisioning",
        items: [
          { title: "Platform Role Assignments", url: "/platform/permissions", icon: Users },
          { title: "Module Access", url: "/platform/permissions", icon: Layers },
          { title: "Feature Flags", url: "/platform/permissions", icon: ToggleLeft },
        ],
      },
    ],
  },
  {
    groupLabel: "Platform Finance",
    module: "platform_finance",
    sections: [
      {
        label: "Billing & Subscriptions",
        icon: CreditCard,
        url: "/platform/billing",
        module: "platform_finance",
        items: [
          { title: "Billing", url: "/platform/billing", icon: CreditCard },
          { title: "Subscription Plans", url: "/platform/billing", icon: Receipt },
          { title: "Platform Invoices", url: "/platform/billing", icon: FileText },
        ],
      },
    ],
  },
  {
    groupLabel: "Oversight",
    module: "oversight",
    sections: [
      {
        label: "Platform Audit Log",
        icon: ShieldCheck,
        url: "/platform/audit-log",
        module: "oversight",
        items: [
          { title: "All Events", url: "/platform/audit-log", icon: ClipboardList },
          { title: "Support Tools", url: "/platform/audit-log", icon: Headphones },
          { title: "Usage Monitoring", url: "/platform/audit-log", icon: Activity },
        ],
      },
      {
        label: "Feature Registry",
        icon: Grid3X3,
        url: "/platform/feature-registry",
        module: "feature_registry",
        items: [],
      },
      {
        label: "Deployment Audit",
        icon: Monitor,
        url: "/platform/audit",
        module: "oversight",
        items: [
          { title: "System & Runtime", url: "/platform/audit", icon: ServerCog },
          { title: "Integrations Status", url: "/platform/audit", icon: Activity },
          { title: "Role Registry", url: "/platform/audit", icon: ShieldCheck },
          { title: "Tenant Overview", url: "/platform/audit", icon: Building2 },
          { title: "Export Audit Bundle", url: "/platform/audit", icon: FileText },
        ],
      },
      {
        label: "AI App Doctor",
        icon: Bot,
        url: "/platform/app-doctor",
        module: "oversight",
        items: [],
      },
      {
        label: "Developer Diagnostics",
        icon: Monitor,
        url: "/platform/developer-diagnostics",
        module: "oversight",
        items: [],
      },
    ],
  },
];

function PlatformLogoutButton() {
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
        data-testid="button-platform-logout"
      >
        <LogOut className="h-4 w-4 mr-2" />
        <span className="text-sm">Logout</span>
      </Button>
    </div>
  );
}

export function PlatformSidebar() {
  const [location] = useLocation();
  const { user } = useAuth();
  const userRole = user?.role || "";

  const canSeeModule = (module?: string) => {
    if (!module) return true;
    return canAccessPlatformModule(userRole, module as any);
  };

  const isActive = (url: string) => {
    if (url === "/platform") return location === "/platform";
    return location.startsWith(url.split("?")[0]);
  };

  const isSubItemActive = (url: string) => {
    const [path, qs] = url.split("?");
    if (location !== path) return false;
    if (!qs) return true;
    const tab = new URLSearchParams(qs).get("tab");
    const locTab = new URLSearchParams(window.location.search).get("tab");
    return tab === locTab;
  };

  function renderSection(section: PlatformNavSection) {
    if (!canSeeModule(section.module)) return null;
    if (section.items.length === 0) {
      return (
        <SidebarMenuItem key={section.label}>
          <SidebarMenuButton asChild isActive={isActive(section.url)} size="lg">
            <Link href={section.url} data-testid={`link-platform-nav-${section.label.toLowerCase().replace(/[\s&/]+/g, "-")}`}>
              <section.icon className="h-5 w-5 text-amber-400" />
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
            <SidebarMenuButton isActive={isActive(section.url)} size="lg" data-testid={`link-platform-nav-${section.label.toLowerCase().replace(/[\s&/]+/g, "-")}`}>
              <section.icon className="h-5 w-5 text-amber-400" />
              <span className="text-[15px] font-medium">{section.label}</span>
              <ChevronDown className="ml-auto h-4 w-4 transition-transform group-data-[state=open]/collapsible:rotate-180" />
            </SidebarMenuButton>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <SidebarMenuSub>
              {section.items.map((item) => (
                <SidebarMenuSubItem key={item.title}>
                  <SidebarMenuSubButton asChild isActive={isSubItemActive(item.url)} size="md">
                    <Link href={item.url} data-testid={`link-platform-subnav-${item.title.toLowerCase().replace(/[\s/&]+/g, "-")}`}>
                      <item.icon className="h-4 w-4 text-amber-400/70" />
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
      <SidebarHeader className="p-4 pb-3">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <img src={paylinkLogo} alt="PayLink" className="h-10 w-10 object-contain" />
            <div className="flex flex-col">
              <span className="text-sm font-bold tracking-tight">PayLink</span>
              <span className="text-[11px] text-amber-400 dark:text-amber-300 font-semibold uppercase tracking-widest">Platform Console</span>
            </div>
          </div>
          <Link href="/app">
            <button className="w-full flex items-center gap-2 text-xs text-sidebar-foreground/60 hover:text-sidebar-foreground px-2 py-1.5 rounded-md hover:bg-sidebar-accent transition-colors" data-testid="btn-back-tenant-app">
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Tenant App
            </button>
          </Link>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {PLATFORM_NAV.map((group) => {
          if (group.module && !canSeeModule(group.module)) return null;
          const visibleSections = group.sections.filter(s => canSeeModule(s.module));
          if (visibleSections.length === 0) return null;

          if (!group.groupLabel) {
            return (
              <SidebarGroup key="home">
                <SidebarGroupContent>
                  <SidebarMenu>
                    {visibleSections.map(s => renderSection(s))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            );
          }

          return (
            <SidebarGroup key={group.groupLabel}>
              <SidebarGroupLabel className="text-[11px] uppercase tracking-widest text-amber-400/50 font-semibold px-2 py-1">
                {group.groupLabel}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {visibleSections.map(s => renderSection(s))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>

      <SidebarFooter className="p-4 space-y-3">
        <div className="text-[10px] text-amber-400/60 uppercase tracking-widest font-semibold px-1">
          Internal Only — Not Tenant-Facing
        </div>
        {isPlatformRole(userRole) && (
          <div className="text-[10px] text-sidebar-foreground/40 px-1">
            Role: <span className="text-amber-400/80">{userRole}</span>
          </div>
        )}
        <PlatformLogoutButton />
        <div className="text-xs text-sidebar-foreground/50">PayLink Platform v2.0</div>
      </SidebarFooter>
    </Sidebar>
  );
}
