import { useLocation, Link } from "wouter";
import {
  LayoutDashboard,
  Kanban,
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
  Settings,
  Grid3X3,
  FileBadge,
  Handshake,
  Rocket,
  Building2,
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

type PlatformNavItem = {
  title: string;
  url: string;
  icon: any;
};

type PlatformNavSection = {
  label: string;
  icon: any;
  url: string;
  items: PlatformNavItem[];
};

const platformSections: PlatformNavSection[] = [
  {
    label: "Console Home",
    icon: LayoutDashboard,
    url: "/platform",
    items: [],
  },
  {
    label: "Sales & Licensing",
    icon: Handshake,
    url: "/platform/deal-pipeline",
    items: [
      { title: "Deal Pipeline", url: "/platform/deal-pipeline", icon: Kanban },
      { title: "License Requests", url: "/platform/license-requests", icon: FileBadge },
      { title: "Agreements", url: "/platform/agreements", icon: FileText },
    ],
  },
  {
    label: "Customer Success",
    icon: Rocket,
    url: "/platform/onboarding-projects",
    items: [
      { title: "Onboarding Projects", url: "/platform/onboarding-projects", icon: ClipboardCheck },
      { title: "Templates", url: "/platform/onboarding-templates", icon: LayoutTemplate },
      { title: "Engagement Feed", url: "/platform/engagement-feed", icon: Rss },
      { title: "Contractor Onboarding", url: "/platform/contractor-onboarding", icon: UserCheck },
    ],
  },
  {
    label: "Platform Admin",
    icon: Settings,
    url: "/platform/provisioning",
    items: [
      { title: "Provisioning", url: "/platform/provisioning", icon: ServerCog },
      { title: "Tenant Setup", url: "/platform/provisioning", icon: Building2 },
      { title: "Permissions", url: "/platform/permissions", icon: KeyRound },
      { title: "Platform Audit Log", url: "/platform/audit-log", icon: ShieldCheck },
      { title: "Billing", url: "/platform/billing", icon: CreditCard },
    ],
  },
  {
    label: "Feature Registry",
    icon: Grid3X3,
    url: "/platform/feature-registry",
    items: [],
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

  const isActive = (url: string) => {
    if (url === "/platform") return location === "/platform";
    return location.startsWith(url.split("?")[0]);
  };

  const isSubItemActive = (url: string) => {
    const basePath = url.split("?")[0];
    return location === basePath;
  };

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
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {platformSections.map((section) => {
                if (section.items.length === 0) {
                  return (
                    <SidebarMenuItem key={section.label}>
                      <SidebarMenuButton asChild isActive={isActive(section.url)} size="lg">
                        <Link href={section.url} data-testid={`link-platform-nav-${section.label.toLowerCase().replace(/\s+/g, "-")}`}>
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
                        <SidebarMenuButton isActive={isActive(section.url)} size="lg" data-testid={`link-platform-nav-${section.label.toLowerCase().replace(/\s+/g, "-")}`}>
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
                                <Link href={item.url} data-testid={`link-platform-subnav-${item.title.toLowerCase().replace(/[\s/&]/g, "-")}`}>
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
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-4 space-y-3">
        <div className="text-[10px] text-amber-400/60 uppercase tracking-widest font-semibold px-1">Internal Only — Not Tenant-Facing</div>
        <PlatformLogoutButton />
        <div className="text-xs text-sidebar-foreground/50">PayLink Platform v2.0</div>
      </SidebarFooter>
    </Sidebar>
  );
}
