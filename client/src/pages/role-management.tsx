import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Users, Shield, KeyRound, Pencil, Plus, Trash2, Search, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type UserRecord = { id: string; username: string; role: string; companyId?: string | null; workerId?: string | null; isActive: boolean };
type Role = { id: string; name: string; description?: string; level: number; isSystem?: boolean; companyId?: string | null; capabilities?: string | null };
type RolePermission = { id: string; roleId: string; resource: string; canView: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport: boolean; canApprove: boolean; canConfigure: boolean };

const TENANT_ROLES = [
  "tenant_owner", "tenant_admin", "tenant_hr_admin", "tenant_payroll_admin",
  "tenant_finance_admin", "tenant_manager", "tenant_supervisor",
  "admin", "manager", "supervisor", "employee", "contractor",
];

const ROLE_LABELS: Record<string, string> = {
  tenant_owner: "Owner", tenant_admin: "Admin", tenant_hr_admin: "HR Admin",
  tenant_payroll_admin: "Payroll Admin", tenant_finance_admin: "Finance Admin",
  tenant_manager: "Manager", tenant_supervisor: "Supervisor",
  admin: "Admin (legacy)", manager: "Manager (legacy)", supervisor: "Supervisor (legacy)",
  employee: "Employee", contractor: "Contractor",
};

function roleBadgeColor(role: string) {
  if (role.includes("owner") || role.includes("admin")) return "destructive";
  if (role.includes("manager") || role.includes("supervisor")) return "secondary";
  return "outline";
}

// ─── Tab 1: Role Assignments ──────────────────────────────────────────────────
function RoleAssignmentsTab() {
  const { user: me } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState("");

  const { data: users = [], isLoading } = useQuery<UserRecord[]>({ queryKey: ["/api/users"] });

  const patchUser = useMutation({
    mutationFn: (vars: { id: string; role: string }) => apiRequest("PATCH", `/api/users/${vars.id}`, { role: vars.role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setEditingId(null);
      toast({ title: "Role updated" });
    },
    onError: () => toast({ title: "Failed to update role", variant: "destructive" }),
  });

  const filtered = users.filter(u =>
    u.username.toLowerCase().includes(search.toLowerCase()) ||
    u.role.toLowerCase().includes(search.toLowerCase())
  );

  const tenantUsers = filtered.filter(u => u.companyId != null || !u.role.startsWith("platform_"));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search users or roles…"
            className="pl-9"
            value={search}
            onChange={e => setSearch(e.target.value)}
            data-testid="input-role-search"
          />
        </div>
        <Badge variant="secondary">{tenantUsers.length} user{tenantUsers.length !== 1 ? "s" : ""}</Badge>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : tenantUsers.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <Users className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p>No users found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Username</TableHead>
                <TableHead>Current Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[180px]">Change Role</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenantUsers.map(u => (
                <TableRow key={u.id} data-testid={`row-user-${u.id}`}>
                  <TableCell className="font-medium">{u.username}</TableCell>
                  <TableCell>
                    <Badge variant={roleBadgeColor(u.role)} className="text-xs">
                      {ROLE_LABELS[u.role] ?? u.role}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.isActive ? "default" : "secondary"} className="text-xs">
                      {u.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {editingId === u.id ? (
                      <div className="flex gap-2">
                        <Select value={editRole} onValueChange={setEditRole}>
                          <SelectTrigger className="h-8 text-xs" data-testid={`select-role-${u.id}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {TENANT_ROLES.map(r => (
                              <SelectItem key={r} value={r}>{ROLE_LABELS[r] ?? r}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          size="sm"
                          className="h-8 text-xs"
                          disabled={patchUser.isPending}
                          onClick={() => patchUser.mutate({ id: u.id, role: editRole })}
                          data-testid={`button-save-role-${u.id}`}
                        >
                          Save
                        </Button>
                        <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setEditingId(null)}>
                          ✕
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs"
                        disabled={u.id === me?.id}
                        onClick={() => { setEditingId(u.id); setEditRole(u.role); }}
                        data-testid={`button-edit-role-${u.id}`}
                      >
                        <Pencil className="h-3 w-3 mr-1" />
                        {u.id === me?.id ? "You" : "Edit"}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Card className="border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/20">
        <CardContent className="pt-4 pb-3">
          <div className="flex gap-2 text-sm text-amber-800 dark:text-amber-300">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>Platform-scoped accounts (platform_super_admin etc.) are managed from the Platform Console and are not shown here.</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Tab 2: Custom Roles ──────────────────────────────────────────────────────
type Capabilities = { canView: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport: boolean; canApprove: boolean; canConfigure: boolean };
const DEFAULT_CAPS: Capabilities = { canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false, canApprove: false, canConfigure: false };
const CAP_LABELS: Array<{ key: keyof Capabilities; label: string }> = [
  { key: "canView", label: "View" }, { key: "canCreate", label: "Create" }, { key: "canEdit", label: "Edit" },
  { key: "canDelete", label: "Delete" }, { key: "canExport", label: "Export" },
  { key: "canApprove", label: "Approve" }, { key: "canConfigure", label: "Configure" },
];

function parseCaps(raw?: string | null): Capabilities {
  try { return raw ? { ...DEFAULT_CAPS, ...JSON.parse(raw) } : { ...DEFAULT_CAPS }; } catch { return { ...DEFAULT_CAPS }; }
}

function CustomRolesTab() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editRole, setEditRole] = useState<Role | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [level, setLevel] = useState("50");
  const [caps, setCaps] = useState<Capabilities>({ ...DEFAULT_CAPS });

  const { data: roles = [], isLoading } = useQuery<Role[]>({ queryKey: ["/api/roles"] });
  const customRoles = roles.filter(r => !r.isSystem);

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/roles", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/roles"] });
      setDialogOpen(false);
      resetForm();
      toast({ title: "Custom role created" });
    },
    onError: () => toast({ title: "Failed to create role", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: (data: any) => apiRequest("PATCH", `/api/roles/${data.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/roles"] });
      setDialogOpen(false);
      resetForm();
      toast({ title: "Role updated" });
    },
    onError: () => toast({ title: "Failed to update role", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/roles/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/roles"] });
      toast({ title: "Role deleted" });
    },
    onError: () => toast({ title: "Failed to delete role", variant: "destructive" }),
  });

  function resetForm() { setName(""); setDescription(""); setLevel("50"); setCaps({ ...DEFAULT_CAPS }); setEditRole(null); }

  function openCreate() { resetForm(); setDialogOpen(true); }
  function openEdit(r: Role) {
    setEditRole(r);
    setName(r.name);
    setDescription(r.description || "");
    setLevel(String(r.level));
    setCaps(parseCaps(r.capabilities));
    setDialogOpen(true);
  }

  function submit() {
    if (!name.trim()) return toast({ title: "Name is required", variant: "destructive" });
    const payload = { name: name.trim(), description: description.trim(), level: parseInt(level), capabilities: JSON.stringify(caps) };
    if (editRole) updateMutation.mutate({ ...payload, id: editRole.id });
    else createMutation.mutate(payload);
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{customRoles.length} custom role{customRoles.length !== 1 ? "s" : ""} defined</p>
        <Dialog open={dialogOpen} onOpenChange={open => { setDialogOpen(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild>
            <Button size="sm" onClick={openCreate} data-testid="button-create-custom-role">
              <Plus className="h-4 w-4 mr-1" /> New Custom Role
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editRole ? "Edit Custom Role" : "Create Custom Role"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-1">
                <Label>Role Name</Label>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Scheduling Coordinator" data-testid="input-role-name" />
              </div>
              <div className="space-y-1">
                <Label>Description <span className="text-muted-foreground">(optional)</span></Label>
                <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Describe what this role can do…" rows={3} data-testid="input-role-description" />
              </div>
              <div className="space-y-1">
                <Label>Permission Level <span className="text-muted-foreground">(1=employee, 50=manager, 100=admin)</span></Label>
                <Input type="number" min={1} max={100} value={level} onChange={e => setLevel(e.target.value)} data-testid="input-role-level" />
              </div>
              <div className="space-y-2">
                <Label>Default Capabilities</Label>
                <p className="text-xs text-muted-foreground">Select the capabilities this role has by default across all resources.</p>
                <div className="grid grid-cols-2 gap-2 border rounded-lg p-3 bg-muted/30">
                  {CAP_LABELS.map(({ key, label }) => (
                    <div key={key} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id={`cap-${key}`}
                        checked={caps[key]}
                        onChange={e => setCaps(c => ({ ...c, [key]: e.target.checked }))}
                        className="cursor-pointer"
                        data-testid={`cap-checkbox-${key}`}
                      />
                      <label htmlFor={`cap-${key}`} className="text-sm cursor-pointer select-none">{label}</label>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <Button onClick={submit} disabled={isPending} data-testid="button-save-custom-role">
                  {isPending ? "Saving…" : editRole ? "Save Changes" : "Create Role"}
                </Button>
                <Button variant="ghost" onClick={() => { setDialogOpen(false); resetForm(); }}>Cancel</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : customRoles.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <Shield className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p className="font-medium mb-1">No custom roles yet</p>
            <p className="text-xs">Create custom roles to give fine-grained access beyond the standard set.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Level</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customRoles.map(r => (
                <TableRow key={r.id} data-testid={`row-role-${r.id}`}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{r.description || "—"}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-xs">{r.level}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(r)} data-testid={`button-edit-role-${r.id}`}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => deleteMutation.mutate(r.id)}
                        disabled={deleteMutation.isPending}
                        data-testid={`button-delete-role-${r.id}`}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {roles.filter(r => r.isSystem).map(r => (
          <Card key={r.id} className="bg-muted/30">
            <CardContent className="pt-3 pb-3">
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-sm">{r.name}</span>
                <Badge variant="outline" className="text-xs">system</Badge>
              </div>
              <p className="text-xs text-muted-foreground">{r.description || "Built-in role"}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ─── Tab 3: Permission Overrides ──────────────────────────────────────────────
type MatrixData = {
  roles: Role[];
  permissions: RolePermission[];
  users: UserRecord[];
  userRoles: any[];
};

const ACTION_KEYS = ["canView", "canCreate", "canEdit", "canDelete", "canExport", "canApprove", "canConfigure"] as const;
const SCOPE_KEYS = ["canViewOwn", "canEditOwn", "canViewSubordinates", "canEditSubordinates", "canApproveSubordinates", "canViewDepartment", "canEditDepartment", "canViewCompany", "canEditCompany"] as const;
const PERM_KEYS = [...ACTION_KEYS, ...SCOPE_KEYS] as const;
const PERM_LABELS: Record<string, string> = {
  canView: "View", canCreate: "Create", canEdit: "Edit",
  canDelete: "Delete", canExport: "Export", canApprove: "Approve", canConfigure: "Configure",
  canViewOwn: "View Own", canEditOwn: "Edit Own",
  canViewSubordinates: "View Sub.", canEditSubordinates: "Edit Sub.", canApproveSubordinates: "Approve Sub.",
  canViewDepartment: "View Dept", canEditDepartment: "Edit Dept",
  canViewCompany: "View Co.", canEditCompany: "Edit Co.",
};

const SCOPE_OPTIONS = [
  { value: "all", label: "All Scopes" },
  { value: "tenant", label: "Tenant" },
  { value: "department", label: "Department" },
  { value: "direct_reports", label: "Direct Reports" },
  { value: "self", label: "Self" },
] as const;

function PermissionOverridesTab() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [scopeFilter, setScopeFilter] = useState(() => localStorage.getItem("perm-scope-filter") || "all");

  const { data: matrix, isLoading } = useQuery<MatrixData>({ queryKey: ["/api/permissions/matrix"] });

  const updatePerm = useMutation({
    mutationFn: (vars: { id: string; field: string; value: boolean }) =>
      apiRequest("PATCH", `/api/role-permissions/${vars.id}`, { [vars.field]: vars.value }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/permissions/matrix"] });
      toast({ title: "Permission updated" });
    },
    onError: () => toast({ title: "Failed to update permission", variant: "destructive" }),
  });

  if (isLoading) return <p className="text-muted-foreground text-sm">Loading…</p>;
  if (!matrix) return <p className="text-destructive text-sm">Failed to load permission matrix.</p>;

  const { roles = [], permissions = [] } = matrix;

  const scopedRoles = roles.filter(r => {
    if (scopeFilter === "all") return true;
    if (scopeFilter === "tenant") return r.level >= 40;
    if (scopeFilter === "department") return r.level >= 20 && r.level < 40;
    if (scopeFilter === "direct_reports") return r.level >= 5 && r.level < 20;
    if (scopeFilter === "self") return r.level < 5;
    return true;
  });

  const resources = Array.from(new Set(permissions.map(p => p.resource))).sort();
  const filteredResources = resources.filter(r => r.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[160px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Filter resources…"
            className="pl-9"
            value={search}
            onChange={e => setSearch(e.target.value)}
            data-testid="input-perm-search"
          />
        </div>
        <Select value={scopeFilter} onValueChange={v => { setScopeFilter(v); localStorage.setItem("perm-scope-filter", v); }}>
          <SelectTrigger className="w-[160px]" data-testid="select-perm-scope">
            <SelectValue placeholder="Scope" />
          </SelectTrigger>
          <SelectContent>
            {SCOPE_OPTIONS.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Badge variant="secondary">{filteredResources.length} resource{filteredResources.length !== 1 ? "s" : ""}</Badge>
      </div>

      {filteredResources.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <KeyRound className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p>No resources found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredResources.map(resource => {
            const resourcePerms = permissions.filter(p => p.resource === resource);
            return (
              <Card key={resource}>
                <CardHeader className="pb-2 pt-3 px-4">
                  <CardTitle className="text-sm font-medium capitalize">{resource.replace(/_/g, " ")}</CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-3">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr>
                          <th className="text-left py-1 pr-3 text-muted-foreground font-normal w-32" rowSpan={2}>Role</th>
                          <th colSpan={ACTION_KEYS.length} className="text-center py-0.5 px-1 text-muted-foreground font-semibold border-b border-border/30 bg-muted/30">Actions</th>
                          <th colSpan={SCOPE_KEYS.length} className="text-center py-0.5 px-1 text-muted-foreground font-semibold border-b border-border/30 bg-muted/20 border-l border-border/40">Scope</th>
                        </tr>
                        <tr>
                          {ACTION_KEYS.map(k => (
                            <th key={k} className="text-center py-1 px-1.5 text-muted-foreground font-normal whitespace-nowrap">{PERM_LABELS[k]}</th>
                          ))}
                          {SCOPE_KEYS.map(k => (
                            <th key={k} className="text-center py-1 px-1.5 text-muted-foreground font-normal whitespace-nowrap border-l border-border/30 first:border-l">{PERM_LABELS[k]}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {scopedRoles.map(role => {
                          const perm = resourcePerms.find(p => p.roleId === role.id);
                          if (!perm) return null;
                          return (
                            <tr key={role.id} className="border-t border-border/50">
                              <td className="py-1.5 pr-3 font-medium">{role.name}</td>
                              {ACTION_KEYS.map(k => (
                                <td key={k} className="text-center py-1.5 px-1.5">
                                  <input
                                    type="checkbox"
                                    className="cursor-pointer"
                                    checked={!!(perm as any)[k]}
                                    onChange={e => updatePerm.mutate({ id: perm.id, field: k, value: e.target.checked })}
                                    disabled={updatePerm.isPending}
                                    data-testid={`perm-${perm.id}-${k}`}
                                  />
                                </td>
                              ))}
                              {SCOPE_KEYS.map((k, i) => (
                                <td key={k} className={`text-center py-1.5 px-1.5${i === 0 ? " border-l border-border/30" : ""}`}>
                                  <input
                                    type="checkbox"
                                    className="cursor-pointer accent-blue-500"
                                    checked={!!(perm as any)[k]}
                                    onChange={e => updatePerm.mutate({ id: perm.id, field: k, value: e.target.checked })}
                                    disabled={updatePerm.isPending}
                                    data-testid={`perm-${perm.id}-${k}`}
                                  />
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function RoleManagementPage() {
  const [location] = useLocation();
  const params = new URLSearchParams(location.split("?")[1] || "");
  const initialTab = params.get("tab") || "assignments";

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Role & Permission Management</h1>
        <p className="text-muted-foreground mt-1">
          Manage user role assignments, define custom roles, and configure permission overrides for this tenant.
        </p>
      </div>

      <Tabs defaultValue={initialTab}>
        <TabsList data-testid="tabs-role-management">
          <TabsTrigger value="assignments" data-testid="tab-role-assignments">
            <Users className="h-4 w-4 mr-2" /> Role Assignments
          </TabsTrigger>
          <TabsTrigger value="custom-roles" data-testid="tab-custom-roles">
            <Shield className="h-4 w-4 mr-2" /> Custom Roles
          </TabsTrigger>
          <TabsTrigger value="overrides" data-testid="tab-permission-overrides">
            <KeyRound className="h-4 w-4 mr-2" /> Permission Overrides
          </TabsTrigger>
        </TabsList>

        <TabsContent value="assignments" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Role Assignments</CardTitle>
              <CardDescription>View and change the role assigned to each user in your organization.</CardDescription>
            </CardHeader>
            <CardContent>
              <RoleAssignmentsTab />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="custom-roles" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Custom Roles</CardTitle>
              <CardDescription>Create and manage custom roles beyond the built-in set. Assign them to users via Role Assignments.</CardDescription>
            </CardHeader>
            <CardContent>
              <CustomRolesTab />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="overrides" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Permission Overrides</CardTitle>
              <CardDescription>Fine-tune what each role can do per resource. Changes take effect immediately.</CardDescription>
            </CardHeader>
            <CardContent>
              <PermissionOverridesTab />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
