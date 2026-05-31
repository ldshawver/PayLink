import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  FileBadge, ClipboardCheck, Rss, ServerCog, ShieldCheck,
  CreditCard, ArrowRight, TrendingUp, Users, Building2, AlertTriangle
} from "lucide-react";

function StatCard({ label, value, icon: Icon, href, color }: {
  label: string; value: string | number; icon: any; href: string; color: string;
}) {
  return (
    <Link href={href}>
      <Card className="cursor-pointer hover:shadow-md transition-shadow group border">
        <CardContent className="p-4 flex items-center gap-4">
          <div className={`h-11 w-11 rounded-xl flex items-center justify-center ${color}`}>
            <Icon className="h-5 w-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-2xl font-bold text-foreground">{value}</p>
            <p className="text-xs text-muted-foreground truncate">{label}</p>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        </CardContent>
      </Card>
    </Link>
  );
}

function ModuleCard({ title, description, href, items, badge }: {
  title: string; description: string; href: string; items: string[]; badge?: string;
}) {
  return (
    <Link href={href}>
      <Card className="cursor-pointer hover:shadow-md transition-all group border h-full">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-sm font-semibold">{title}</CardTitle>
            {badge && <Badge variant="secondary" className="text-xs shrink-0">{badge}</Badge>}
          </div>
          <p className="text-xs text-muted-foreground">{description}</p>
        </CardHeader>
        <CardContent className="pt-0">
          <ul className="space-y-1">
            {items.map(item => (
              <li key={item} className="flex items-center gap-2 text-xs text-muted-foreground">
                <div className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                {item}
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-1 text-xs text-amber-500 font-medium mt-3 opacity-0 group-hover:opacity-100 transition-opacity">
            Open <ArrowRight className="h-3 w-3" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export default function PlatformHomePage() {
  const { data: licenses = [] } = useQuery<any[]>({ queryKey: ["/api/license-requests"] });
  const { data: projects = [] } = useQuery<any[]>({ queryKey: ["/api/onboarding-projects"] });
  const { data: tenants = [] } = useQuery<any[]>({ queryKey: ["/api/tenants"] });

  const pendingLicenses = licenses.filter((l: any) => l.status === "pending").length;
  const activeProjects = projects.filter((p: any) => p.status === "active").length;
  const totalTenants = tenants.length;

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-amber-900 text-white px-6 py-5 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <ServerCog className="h-5 w-5 text-amber-400" />
              <span className="text-xs text-amber-300 font-semibold uppercase tracking-widest">Platform Console</span>
            </div>
            <h1 className="text-xl font-bold">Platform Operations</h1>
            <p className="text-sm text-slate-300 mt-0.5">Internal software-owner workspace — not visible to tenants</p>
          </div>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            <span className="text-xs text-amber-300">Internal Only</span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* Stats Row */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <StatCard label="Pending License Requests" value={pendingLicenses} icon={FileBadge} href="/platform/license-requests" color="bg-orange-500" />
          <StatCard label="Active Onboarding Projects" value={activeProjects} icon={ClipboardCheck} href="/platform/onboarding-projects" color="bg-green-600" />
          <StatCard label="Tenants" value={totalTenants} icon={Building2} href="/platform/tenants" color="bg-slate-600" />
        </div>

        {/* Module Grid */}
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Platform Modules</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <ModuleCard
              title="Licensing"
              description="Manage license requests and signed agreements for provisioned tenants."
              href="/platform/license-requests"
              badge="Licensing"
              items={["License Requests", "Agreements & Signed Agreements"]}
            />
            <ModuleCard
              title="Customer Success"
              description="Onboard new tenants, track implementation progress, and monitor engagement."
              href="/platform/onboarding-projects"
              badge="CS"
              items={["Onboarding Projects", "Templates", "Engagement Feed", "Contractor Onboarding"]}
            />
            <ModuleCard
              title="Platform Admin"
              description="Provision tenants, manage platform-level permissions, billing, and audit logs."
              href="/platform/provisioning"
              badge="Admin"
              items={["Provisioning & Tenant Setup", "Permissions", "Platform Audit Log", "Billing"]}
            />
            <ModuleCard
              title="Feature Registry"
              description="Complete inventory of all product features mapped to their layer, owner, and access controls."
              href="/platform/feature-registry"
              badge="Governance"
              items={["Product Layer Mapping", "Department Owners", "Access Control Matrix", "Audit Requirements"]}
            />
          </div>
        </div>

        {/* Architecture Notice */}
        <div className="border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">Architecture Boundary</p>
              <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">
                All modules in this console are <strong>platform-owner operations</strong> — they are not accessible to tenant users
                and must not appear in the Tenant App navigation. The Tenant App and Employee Portal are served separately via
                <code className="bg-amber-100 dark:bg-amber-900/40 px-1 rounded mx-1">/app/*</code> routes.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
