import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Search, CheckCircle2, XCircle, Clock, AlertTriangle, ShieldCheck,
  Building2, Layers, Zap, History, ChevronRight, ToggleLeft, ToggleRight, Info,
  RefreshCw, Filter
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";

// ── Types ────────────────────────────────────────────────────────────────────

interface FeatureEntry {
  id: string;
  featureKey: string;
  module: string;
  featureName: string;
  layer: string;
  tier: string;
  description: string | null;
  defaultOn: boolean | string;
  isBeta: boolean | string;
  billingImpact: boolean | string;
  sortOrder: number;
  createdAt: string;
}

interface TenantFeatureEntry extends FeatureEntry {
  overrideEnabled: boolean | null;
  overrideExpiresAt: string | null;
  overrideNotes: string | null;
  overrideId: string | null;
  effectiveEnabled: boolean | string;
}

interface Company {
  id: string;
  name: string;
}

interface ActivationLogEntry {
  id: string;
  companyId: string | null;
  companyName: string | null;
  featureKey: string;
  action: string;
  performedByName: string | null;
  notes: string | null;
  expiresAt: string | null;
  createdAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const bool = (v: boolean | string | null | undefined): boolean =>
  v === true || v === "true" || v === "t";

function TierBadge({ tier }: { tier: string }) {
  const colors: Record<string, string> = {
    starter: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    professional: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    enterprise: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
    all: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colors[tier] ?? colors.all}`}>
      {tier}
    </span>
  );
}

function EffectiveStatus({ effective, hasOverride, expiresAt }: {
  effective: boolean; hasOverride: boolean; expiresAt?: string | null;
}) {
  const isExpired = expiresAt ? new Date(expiresAt) < new Date() : false;
  if (isExpired) return (
    <span className="flex items-center gap-1 text-amber-600 text-xs">
      <Clock className="h-3.5 w-3.5" /> expired override
    </span>
  );
  if (!effective) return (
    <span className="flex items-center gap-1 text-red-500 text-xs font-medium">
      <XCircle className="h-3.5 w-3.5" /> disabled{hasOverride && " (override)"}
    </span>
  );
  return (
    <span className="flex items-center gap-1 text-emerald-600 text-xs font-medium">
      <CheckCircle2 className="h-3.5 w-3.5" /> enabled{hasOverride && " (override)"}
    </span>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function FeatureRegistryPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const isPlatformAdmin =
    user?.role === "platform_super_admin" || user?.role === "platform_admin";

  const [tab, setTab] = useState("registry");
  const [search, setSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState("all");
  const [tierFilter, setTierFilter] = useState("__all__");
  const [layerFilter, setLayerFilter] = useState("tenant");

  // Registry query
  const { data: registry = [], isLoading: regLoading, refetch: refetchRegistry } = useQuery<FeatureEntry[]>({
    queryKey: ["/api/feature-registry"],
  });

  // Tenant list — load always so the wizard can reference companies from any tab
  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
  });

  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("");

  // Tenant feature set
  const { data: tenantFeatures = [], isLoading: tfLoading, refetch: refetchTenantFeatures } = useQuery<TenantFeatureEntry[]>({
    queryKey: ["/api/feature-registry/tenant", selectedCompanyId],
    queryFn: () => fetch(`/api/feature-registry/tenant/${selectedCompanyId}`, { credentials: "include" }).then(r => r.json()),
    enabled: !!selectedCompanyId && tab === "tenants",
  });

  // Activation log
  const [logCompany, setLogCompany] = useState("__all__");
  const { data: activationLog = [], isLoading: logLoading, refetch: refetchLog } = useQuery<ActivationLogEntry[]>({
    queryKey: ["/api/feature-registry/log", logCompany],
    queryFn: () => {
      const url = (logCompany && logCompany !== "__all__")
        ? `/api/feature-registry/log?companyId=${logCompany}`
        : "/api/feature-registry/log";
      return fetch(url, { credentials: "include" }).then(r => r.json());
    },
    enabled: tab === "log",
  });

  // ── Activation wizard state ──────────────────────────────────────────────
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [wizardCompanyId, setWizardCompanyId] = useState("");
  const [wizardFeatureKey, setWizardFeatureKey] = useState("");
  const [wizardEnabled, setWizardEnabled] = useState(true);
  const [wizardExpiry, setWizardExpiry] = useState("");
  const [wizardNotes, setWizardNotes] = useState("");

  function openWizard(companyId?: string, featureKey?: string, currentlyEnabled?: boolean) {
    setWizardCompanyId(companyId ?? selectedCompanyId ?? "");
    setWizardFeatureKey(featureKey ?? "");
    setWizardEnabled(typeof currentlyEnabled === "boolean" ? !currentlyEnabled : true);
    setWizardExpiry("");
    setWizardNotes("");
    setWizardStep(1);
    setWizardOpen(true);
  }

  const activateMutation = useMutation({
    mutationFn: (payload: { companyId: string; featureKey: string; enabled: boolean; expiresAt?: string; notes?: string }) =>
      apiRequest("POST", "/api/feature-registry/activate", payload),
    onSuccess: () => {
      toast({ title: "Feature updated", description: `Feature "${wizardFeatureKey}" has been ${wizardEnabled ? "enabled" : "disabled"} for the selected tenant.` });
      qc.invalidateQueries({ queryKey: ["/api/feature-registry/tenant", wizardCompanyId] });
      qc.invalidateQueries({ queryKey: ["/api/feature-registry/log"] });
      setWizardOpen(false);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message ?? "Failed to update feature", variant: "destructive" });
    },
  });

  function handleWizardConfirm() {
    activateMutation.mutate({
      companyId: wizardCompanyId,
      featureKey: wizardFeatureKey,
      enabled: wizardEnabled,
      expiresAt: wizardExpiry || undefined,
      notes: wizardNotes || undefined,
    });
  }

  // ── Filtering ──────────────────────────────────────────────────────────────

  const modules = useMemo(() => {
    const set = new Set(registry.map(f => f.module));
    return Array.from(set).sort();
  }, [registry]);

  const filteredRegistry = useMemo(() => {
    return registry.filter(f => {
      if (layerFilter !== "all" && f.layer !== layerFilter) return false;
      if (moduleFilter !== "all" && f.module !== moduleFilter) return false;
      if (tierFilter !== "__all__" && f.tier !== tierFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return f.featureName?.toLowerCase().includes(q) ||
          f.featureKey?.toLowerCase().includes(q) ||
          f.module?.toLowerCase().includes(q) ||
          f.description?.toLowerCase().includes(q);
      }
      return true;
    });
  }, [registry, search, moduleFilter, tierFilter, layerFilter]);

  const tenantModules = useMemo(() => {
    const set = new Set(tenantFeatures.map(f => f.module));
    return Array.from(set).sort();
  }, [tenantFeatures]);

  const [tenantSearch, setTenantSearch] = useState("");
  const [tenantModFilter, setTenantModFilter] = useState("all");
  const [tenantTierFilter, setTenantTierFilter] = useState("__all__");

  const filteredTenantFeatures = useMemo(() => {
    return tenantFeatures.filter(f => {
      if (tenantModFilter !== "all" && f.module !== tenantModFilter) return false;
      if (tenantTierFilter !== "__all__" && f.tier !== tenantTierFilter) return false;
      if (tenantSearch) {
        const q = tenantSearch.toLowerCase();
        return f.featureName?.toLowerCase().includes(q) ||
          f.featureKey?.toLowerCase().includes(q);
      }
      return true;
    });
  }, [tenantFeatures, tenantSearch, tenantModFilter, tenantTierFilter]);

  const selectedCompany = companies.find(c => c.id === selectedCompanyId);

  // ── Wizard feature info ───────────────────────────────────────────────────
  const wizardFeature = registry.find(f => f.featureKey === wizardFeatureKey);
  const wizardCompany = companies.find(c => c.id === wizardCompanyId);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6 p-6 max-w-screen-xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Layers className="h-6 w-6 text-teal-600" />
            Feature Registry
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Platform-level feature catalogue. Enable or disable features per tenant with expiry and audit trail.
          </p>
        </div>
        {isPlatformAdmin && (
          <Button
            data-testid="button-open-activation-wizard"
            onClick={() => openWizard()}
            className="shrink-0"
          >
            <Zap className="h-4 w-4 mr-2" />
            Activate Feature
          </Button>
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-2">
          <TabsTrigger value="registry" data-testid="tab-registry">
            <ShieldCheck className="h-4 w-4 mr-1.5" />Registry ({registry.length})
          </TabsTrigger>
          <TabsTrigger value="tenants" data-testid="tab-tenants">
            <Building2 className="h-4 w-4 mr-1.5" />Per Tenant
          </TabsTrigger>
          <TabsTrigger value="log" data-testid="tab-activation-log">
            <History className="h-4 w-4 mr-1.5" />Activation Log
          </TabsTrigger>
        </TabsList>

        {/* ── Registry Tab ─────────────────────────────────────────────────── */}
        <TabsContent value="registry">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Filter className="h-4 w-4" /> Filter & Search
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-3 mb-4">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    data-testid="input-registry-search"
                    placeholder="Search features..."
                    className="pl-8"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </div>
                <Select value={layerFilter} onValueChange={setLayerFilter}>
                  <SelectTrigger className="w-36" data-testid="select-layer-filter">
                    <SelectValue placeholder="Layer" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All layers</SelectItem>
                    <SelectItem value="platform">Platform</SelectItem>
                    <SelectItem value="tenant">Tenant</SelectItem>
                    <SelectItem value="employee">Employee</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={moduleFilter} onValueChange={setModuleFilter}>
                  <SelectTrigger className="w-44" data-testid="select-module-filter">
                    <SelectValue placeholder="Module" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All modules</SelectItem>
                    {modules.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={tierFilter} onValueChange={setTierFilter}>
                  <SelectTrigger className="w-36" data-testid="select-tier-filter">
                    <SelectValue placeholder="Tier" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All tiers</SelectItem>
                    <SelectItem value="starter">Starter</SelectItem>
                    <SelectItem value="professional">Professional</SelectItem>
                    <SelectItem value="enterprise">Enterprise</SelectItem>
                    <SelectItem value="all">All (always on)</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="icon" onClick={() => refetchRegistry()} title="Refresh">
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>

              {regLoading ? (
                <div className="text-muted-foreground text-sm py-8 text-center">Loading registry…</div>
              ) : filteredRegistry.length === 0 ? (
                <div className="text-muted-foreground text-sm py-8 text-center">No features match your filters.</div>
              ) : (
                <div className="overflow-x-auto rounded border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-muted-foreground">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium">Feature</th>
                        <th className="text-left px-3 py-2 font-medium">Module</th>
                        <th className="text-left px-3 py-2 font-medium">Tier</th>
                        <th className="text-left px-3 py-2 font-medium">Layer</th>
                        <th className="text-left px-3 py-2 font-medium">Default</th>
                        <th className="text-left px-3 py-2 font-medium">Flags</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRegistry.map((f, i) => (
                        <tr
                          key={f.id}
                          data-testid={`row-feature-${f.featureKey}`}
                          className={`border-t hover:bg-muted/30 transition-colors ${i % 2 === 0 ? "" : "bg-muted/10"}`}
                        >
                          <td className="px-3 py-2">
                            <div className="font-medium">{f.featureName}</div>
                            <div className="text-xs text-muted-foreground font-mono">{f.featureKey}</div>
                            {f.description && (
                              <div className="text-xs text-muted-foreground mt-0.5 max-w-xs truncate" title={f.description}>{f.description}</div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{f.module}</td>
                          <td className="px-3 py-2"><TierBadge tier={f.tier} /></td>
                          <td className="px-3 py-2">
                            <Badge variant="outline" className="capitalize text-xs">{f.layer}</Badge>
                          </td>
                          <td className="px-3 py-2">
                            {bool(f.defaultOn) ? (
                              <span className="text-emerald-600 text-xs font-medium flex items-center gap-1">
                                <CheckCircle2 className="h-3.5 w-3.5" /> on
                              </span>
                            ) : (
                              <span className="text-muted-foreground text-xs flex items-center gap-1">
                                <XCircle className="h-3.5 w-3.5" /> off
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex gap-1 flex-wrap">
                              {bool(f.isBeta) && <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">beta</Badge>}
                              {bool(f.billingImpact) && <Badge variant="secondary" className="text-xs bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">billing</Badge>}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-2">
                Showing {filteredRegistry.length} of {registry.length} features
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Per Tenant Tab ───────────────────────────────────────────────── */}
        <TabsContent value="tenants">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Manage Features Per Tenant</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-3 mb-4">
                <Select
                  value={selectedCompanyId}
                  onValueChange={v => { setSelectedCompanyId(v); setTenantSearch(""); setTenantModFilter("all"); setTenantTierFilter("__all__"); }}
                >
                  <SelectTrigger className="w-64" data-testid="select-company">
                    <Building2 className="h-4 w-4 mr-2 text-muted-foreground" />
                    <SelectValue placeholder="Select a tenant…" />
                  </SelectTrigger>
                  <SelectContent>
                    {companies.map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {selectedCompanyId && (
                  <>
                    <div className="relative">
                      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        data-testid="input-tenant-feature-search"
                        placeholder="Search features…"
                        className="pl-8 w-48"
                        value={tenantSearch}
                        onChange={e => setTenantSearch(e.target.value)}
                      />
                    </div>
                    <Select value={tenantModFilter} onValueChange={setTenantModFilter}>
                      <SelectTrigger className="w-40" data-testid="select-tenant-module-filter">
                        <SelectValue placeholder="Module" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All modules</SelectItem>
                        {tenantModules.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={tenantTierFilter} onValueChange={setTenantTierFilter}>
                      <SelectTrigger className="w-36" data-testid="select-tenant-tier-filter">
                        <SelectValue placeholder="Tier" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">All tiers</SelectItem>
                        <SelectItem value="starter">Starter</SelectItem>
                        <SelectItem value="professional">Professional</SelectItem>
                        <SelectItem value="enterprise">Enterprise</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button variant="ghost" size="icon" onClick={() => refetchTenantFeatures()}>
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>

              {!selectedCompanyId ? (
                <div className="text-center text-muted-foreground py-12">
                  <Building2 className="h-10 w-10 mx-auto mb-2 opacity-30" />
                  <p>Select a tenant to view and manage their feature set.</p>
                </div>
              ) : tfLoading ? (
                <div className="text-center text-muted-foreground py-8">Loading features for {selectedCompany?.name}…</div>
              ) : filteredTenantFeatures.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">No features match your filters.</div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm text-muted-foreground">
                      {selectedCompany?.name} — {filteredTenantFeatures.filter(f => bool(f.effectiveEnabled)).length} of {filteredTenantFeatures.length} features enabled
                    </span>
                    {isPlatformAdmin && (
                      <Button
                        size="sm"
                        variant="outline"
                        data-testid="button-open-wizard-from-tenant"
                        onClick={() => openWizard(selectedCompanyId)}
                      >
                        <Zap className="h-3.5 w-3.5 mr-1.5" />
                        Bulk Activate
                      </Button>
                    )}
                  </div>
                  <div className="overflow-x-auto rounded border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-muted-foreground">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium">Feature</th>
                          <th className="text-left px-3 py-2 font-medium">Module</th>
                          <th className="text-left px-3 py-2 font-medium">Tier</th>
                          <th className="text-left px-3 py-2 font-medium">Status</th>
                          {isPlatformAdmin && <th className="text-left px-3 py-2 font-medium">Action</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredTenantFeatures.map((f, i) => {
                          const effective = bool(f.effectiveEnabled);
                          const hasOverride = f.overrideId !== null;
                          return (
                            <tr
                              key={f.id}
                              data-testid={`row-tenant-feature-${f.featureKey}`}
                              className={`border-t hover:bg-muted/30 ${i % 2 === 0 ? "" : "bg-muted/10"}`}
                            >
                              <td className="px-3 py-2">
                                <div className="font-medium">{f.featureName}</div>
                                <div className="text-xs text-muted-foreground font-mono">{f.featureKey}</div>
                                {f.overrideNotes && (
                                  <div className="text-xs text-amber-600 mt-0.5 italic">{f.overrideNotes}</div>
                                )}
                              </td>
                              <td className="px-3 py-2 text-muted-foreground text-xs">{f.module}</td>
                              <td className="px-3 py-2"><TierBadge tier={f.tier} /></td>
                              <td className="px-3 py-2">
                                <EffectiveStatus
                                  effective={effective}
                                  hasOverride={hasOverride}
                                  expiresAt={f.overrideExpiresAt}
                                />
                                {f.overrideExpiresAt && !bool(f.effectiveEnabled) === false && (
                                  <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                                    <Clock className="h-3 w-3" />
                                    expires {new Date(f.overrideExpiresAt).toLocaleDateString()}
                                  </div>
                                )}
                              </td>
                              {isPlatformAdmin && (
                                <td className="px-3 py-2">
                                  <Button
                                    size="sm"
                                    variant={effective ? "outline" : "default"}
                                    className="h-7 text-xs"
                                    data-testid={`button-toggle-feature-${f.featureKey}`}
                                    onClick={() => openWizard(selectedCompanyId, f.featureKey, effective)}
                                  >
                                    {effective ? (
                                      <><ToggleRight className="h-3.5 w-3.5 mr-1 text-emerald-600" />Disable</>
                                    ) : (
                                      <><ToggleLeft className="h-3.5 w-3.5 mr-1" />Enable</>
                                    )}
                                  </Button>
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Activation Log Tab ───────────────────────────────────────────── */}
        <TabsContent value="log">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-4">
                <CardTitle className="text-base flex items-center gap-2">
                  <History className="h-4 w-4" /> Activation Audit Log
                </CardTitle>
                <div className="flex gap-2">
                  <Select value={logCompany} onValueChange={setLogCompany}>
                    <SelectTrigger className="w-52" data-testid="select-log-company">
                      <SelectValue placeholder="All tenants" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All tenants</SelectItem>
                      {companies.map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button variant="ghost" size="icon" onClick={() => refetchLog()}>
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {logLoading ? (
                <div className="text-muted-foreground text-sm py-8 text-center">Loading log…</div>
              ) : activationLog.length === 0 ? (
                <div className="text-muted-foreground text-sm py-8 text-center">
                  <History className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  No activation events recorded yet.
                </div>
              ) : (
                <div className="overflow-x-auto rounded border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-muted-foreground">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium">When</th>
                        <th className="text-left px-3 py-2 font-medium">Feature</th>
                        <th className="text-left px-3 py-2 font-medium">Tenant</th>
                        <th className="text-left px-3 py-2 font-medium">Action</th>
                        <th className="text-left px-3 py-2 font-medium">By</th>
                        <th className="text-left px-3 py-2 font-medium">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activationLog.map((entry, i) => (
                        <tr
                          key={entry.id}
                          data-testid={`row-log-${entry.id}`}
                          className={`border-t ${i % 2 === 0 ? "" : "bg-muted/10"}`}
                        >
                          <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(entry.createdAt).toLocaleString()}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">{entry.featureKey}</td>
                          <td className="px-3 py-2 text-xs">{entry.companyName ?? "—"}</td>
                          <td className="px-3 py-2">
                            {entry.action === "enabled" ? (
                              <span className="flex items-center gap-1 text-emerald-600 text-xs font-medium">
                                <CheckCircle2 className="h-3.5 w-3.5" />enabled
                              </span>
                            ) : entry.action === "disabled" ? (
                              <span className="flex items-center gap-1 text-red-500 text-xs font-medium">
                                <XCircle className="h-3.5 w-3.5" />disabled
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">{entry.action}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs">{entry.performedByName ?? "—"}</td>
                          <td className="px-3 py-2 text-xs text-muted-foreground max-w-[200px] truncate" title={entry.notes ?? ""}>{entry.notes ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Activation Wizard Dialog ─────────────────────────────────────── */}
      <Dialog open={wizardOpen} onOpenChange={setWizardOpen}>
        <DialogContent className="sm:max-w-lg" data-testid="dialog-activation-wizard">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-teal-600" />
              {wizardStep === 1 ? "Step 1: Select Feature & Action" :
               wizardStep === 2 ? "Step 2: Set Options" :
               "Step 3: Confirm Activation"}
            </DialogTitle>
          </DialogHeader>

          {/* Step indicator */}
          <div className="flex items-center gap-2 mb-4">
            {[1, 2, 3].map(s => (
              <div key={s} className="flex items-center gap-1">
                <div className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  s < wizardStep ? "bg-teal-600 text-white" :
                  s === wizardStep ? "bg-teal-100 text-teal-700 ring-2 ring-teal-600" :
                  "bg-muted text-muted-foreground"
                }`}>{s < wizardStep ? "✓" : s}</div>
                {s < 3 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
              </div>
            ))}
          </div>

          {/* Step 1 */}
          {wizardStep === 1 && (
            <div className="space-y-4">
              <div>
                <Label className="mb-1.5 block">Tenant</Label>
                <Select value={wizardCompanyId} onValueChange={setWizardCompanyId}>
                  <SelectTrigger data-testid="wizard-select-company">
                    <SelectValue placeholder="Select tenant…" />
                  </SelectTrigger>
                  <SelectContent>
                    {companies.map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-1.5 block">Feature</Label>
                <select
                  data-testid="wizard-select-feature"
                  value={wizardFeatureKey}
                  onChange={e => setWizardFeatureKey(e.target.value)}
                  className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">Select a feature…</option>
                  {registry.filter(f => f.layer === "tenant").map(f => (
                    <option key={f.featureKey} value={f.featureKey}>
                      {f.featureName} — {f.module}
                    </option>
                  ))}
                </select>
                {wizardFeature && (
                  <p className="text-xs text-muted-foreground mt-1 flex items-start gap-1">
                    <Info className="h-3 w-3 mt-0.5 shrink-0" />
                    {wizardFeature.description}
                  </p>
                )}
              </div>
              <div>
                <Label className="mb-1.5 block">Action</Label>
                <div className="flex items-center gap-3 p-3 rounded border bg-muted/20">
                  <Switch
                    checked={wizardEnabled}
                    onCheckedChange={setWizardEnabled}
                    data-testid="wizard-switch-enabled"
                  />
                  <span className={`text-sm font-medium ${wizardEnabled ? "text-emerald-600" : "text-red-500"}`}>
                    {wizardEnabled ? "Enable this feature" : "Disable this feature"}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Step 2 */}
          {wizardStep === 2 && (
            <div className="space-y-4">
              <div>
                <Label className="mb-1.5 block">Expiry Date (optional)</Label>
                <Input
                  type="date"
                  value={wizardExpiry}
                  onChange={e => setWizardExpiry(e.target.value)}
                  data-testid="wizard-input-expiry"
                  min={new Date().toISOString().slice(0, 10)}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  If set, the override expires on this date and reverts to the feature's default state.
                </p>
              </div>
              <div>
                <Label className="mb-1.5 block">Notes (optional)</Label>
                <Textarea
                  placeholder="e.g. Trial period for 30 days, activated per sales request #1234"
                  value={wizardNotes}
                  onChange={e => setWizardNotes(e.target.value)}
                  rows={3}
                  data-testid="wizard-input-notes"
                />
              </div>
            </div>
          )}

          {/* Step 3 */}
          {wizardStep === 3 && (
            <div className="space-y-3">
              <div className="rounded-lg border p-4 bg-muted/20 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tenant</span>
                  <span className="font-medium">{wizardCompany?.name ?? wizardCompanyId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Feature</span>
                  <span className="font-medium">{wizardFeature?.featureName ?? wizardFeatureKey}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Action</span>
                  <span className={`font-semibold ${wizardEnabled ? "text-emerald-600" : "text-red-500"}`}>
                    {wizardEnabled ? "ENABLE" : "DISABLE"}
                  </span>
                </div>
                {wizardExpiry && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Expires</span>
                    <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5 text-amber-500" />{new Date(wizardExpiry).toLocaleDateString()}</span>
                  </div>
                )}
                {wizardNotes && (
                  <div className="pt-2 border-t">
                    <span className="text-muted-foreground block mb-1">Notes</span>
                    <span className="italic text-muted-foreground">{wizardNotes}</span>
                  </div>
                )}
              </div>
              {wizardFeature && bool(wizardFeature.billingImpact) && (
                <div className="flex items-start gap-2 p-3 rounded bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 text-sm border border-amber-200 dark:border-amber-800">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  This feature has billing impact. Activating it may affect invoicing and subscription charges.
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2 pt-2">
            {wizardStep > 1 && (
              <Button variant="outline" onClick={() => setWizardStep(s => s - 1)}>
                Back
              </Button>
            )}
            {wizardStep < 3 ? (
              <Button
                onClick={() => setWizardStep(s => s + 1)}
                disabled={!wizardCompanyId || !wizardFeatureKey}
                data-testid="wizard-button-next"
              >
                Next <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
              <Button
                onClick={handleWizardConfirm}
                disabled={activateMutation.isPending}
                data-testid="wizard-button-confirm"
                className={wizardEnabled ? "bg-teal-600 hover:bg-teal-700" : "bg-red-600 hover:bg-red-700"}
              >
                {activateMutation.isPending ? "Saving…" : `Confirm ${wizardEnabled ? "Enable" : "Disable"}`}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
