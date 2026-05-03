import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Download, Search, Shield, User, CheckCircle2, XCircle, Users } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Role = { id: string; name: string; description?: string; level: number };
type RolePermission = {
  id: string; roleId: string; resource: string;
  canView: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean;
  canExport: boolean; canApprove: boolean; canConfigure: boolean;
  canViewOwn: boolean; canEditOwn: boolean;
  canViewSubordinates: boolean; canEditSubordinates: boolean; canApproveSubordinates: boolean;
  canViewDepartment: boolean; canEditDepartment: boolean; canApproveDepartment: boolean;
  canViewCompany: boolean; canEditCompany: boolean; canApproveCompany: boolean;
};
type UserRecord = { id: string; username: string; role: string; companyId?: string };
type UserRole = { id: string; userId: string; roleId: string; scopeType?: string };
type MatrixData = { roles: Role[]; permissions: RolePermission[]; users: UserRecord[]; userRoles: UserRole[] };

type EffectivePerm = {
  resource: string;
  permissions: string[];
  source: string;
  scope?: string;
};

const FLAT_PERMS: { key: keyof RolePermission; label: string; abbr: string; color: string }[] = [
  { key: "canView",    label: "View",      abbr: "V",  color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" },
  { key: "canCreate",  label: "Create",    abbr: "C",  color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
  { key: "canEdit",    label: "Edit",      abbr: "E",  color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" },
  { key: "canDelete",  label: "Delete",    abbr: "D",  color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" },
  { key: "canExport",  label: "Export",    abbr: "X",  color: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200" },
  { key: "canApprove", label: "Approve",   abbr: "A",  color: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200" },
  { key: "canConfigure", label: "Configure", abbr: "K", color: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200" },
];

const SCOPE_PERMS: { key: keyof RolePermission; label: string; abbr: string; color: string; scope: string }[] = [
  { key: "canViewOwn",             label: "View own",             abbr: "V↑ own",  scope: "own",   color: "border border-blue-400 text-blue-700 dark:text-blue-300 bg-transparent" },
  { key: "canEditOwn",             label: "Edit own",             abbr: "E↑ own",  scope: "own",   color: "border border-yellow-400 text-yellow-700 dark:text-yellow-300 bg-transparent" },
  { key: "canViewSubordinates",    label: "View subordinates",    abbr: "V↓ subs", scope: "subs",  color: "border border-cyan-500 text-cyan-700 dark:text-cyan-300 bg-transparent" },
  { key: "canEditSubordinates",    label: "Edit subordinates",    abbr: "E↓ subs", scope: "subs",  color: "border border-orange-400 text-orange-700 dark:text-orange-300 bg-transparent" },
  { key: "canApproveSubordinates", label: "Approve subordinates", abbr: "A↓ subs", scope: "subs",  color: "border border-teal-500 text-teal-700 dark:text-teal-300 bg-transparent" },
  { key: "canViewDepartment",      label: "View dept",            abbr: "V↓ dept", scope: "dept",  color: "border border-indigo-500 text-indigo-700 dark:text-indigo-300 bg-transparent" },
  { key: "canEditDepartment",      label: "Edit dept",            abbr: "E↓ dept", scope: "dept",  color: "border border-amber-500 text-amber-700 dark:text-amber-300 bg-transparent" },
  { key: "canApproveDepartment",   label: "Approve dept",         abbr: "A↓ dept", scope: "dept",  color: "border border-emerald-500 text-emerald-700 dark:text-emerald-300 bg-transparent" },
  { key: "canViewCompany",         label: "View company",         abbr: "V↓ co",   scope: "co",    color: "border border-violet-500 text-violet-700 dark:text-violet-300 bg-transparent" },
  { key: "canEditCompany",         label: "Edit company",         abbr: "E↓ co",   scope: "co",    color: "border border-rose-500 text-rose-700 dark:text-rose-300 bg-transparent" },
  { key: "canApproveCompany",      label: "Approve company",      abbr: "A↓ co",   scope: "co",    color: "border border-green-600 text-green-700 dark:text-green-300 bg-transparent" },
];

const ALL_PERM_META = [
  ...FLAT_PERMS.map(p => ({ ...p, isScope: false })),
  ...SCOPE_PERMS.map(p => ({ ...p, isScope: true })),
];

const PERM_META_BY_TYPE: Record<string, { abbr: string; color: string }> = Object.fromEntries(
  ALL_PERM_META.map(p => [p.label.toLowerCase().replace(/ /g, "_"), { abbr: p.abbr, color: p.color }])
);

const PERMISSION_ICONS: Record<string, string> = Object.fromEntries(
  ALL_PERM_META.map(p => [p.key.replace(/^can/, "").replace(/([A-Z])/g, "_$1").toLowerCase().replace(/^_/, ""), p.abbr])
);

function PermBadge({ type, abbr, color }: { type: string; abbr?: string; color?: string }) {
  const meta = PERM_META_BY_TYPE[type] || { abbr: (abbr || type[0].toUpperCase()), color: "bg-gray-100 text-gray-600" };
  const displayAbbr = abbr ?? meta.abbr;
  const displayColor = color ?? meta.color;
  return (
    <span
      title={type}
      className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-bold whitespace-nowrap ${displayColor}`}
    >
      {displayAbbr}
    </span>
  );
}

function CellPermissions({ perm }: { perm: RolePermission | undefined }) {
  if (!perm) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }

  const flatGranted = FLAT_PERMS.filter(p => perm[p.key]);
  const scopeGranted = SCOPE_PERMS.filter(p => perm[p.key]);

  if (flatGranted.length === 0 && scopeGranted.length === 0) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }

  return (
    <div className="flex flex-col gap-0.5 items-center">
      {flatGranted.length > 0 && (
        <div className="flex flex-wrap gap-0.5 justify-center">
          {flatGranted.map(p => (
            <span
              key={p.key}
              title={p.label}
              className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-bold whitespace-nowrap ${p.color}`}
            >
              {p.abbr}
            </span>
          ))}
        </div>
      )}
      {scopeGranted.length > 0 && (
        <div className="flex flex-wrap gap-0.5 justify-center">
          {scopeGranted.map(p => (
            <span
              key={p.key}
              title={`${p.label} (scope: ${p.scope})`}
              className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${p.color}`}
            >
              {p.abbr}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function EffectivePermissionsPanel({ users }: { users: UserRecord[] }) {
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [searchUser, setSearchUser] = useState("");

  const filteredUsers = users.filter(u =>
    u.username.toLowerCase().includes(searchUser.toLowerCase())
  );

  const { data: effectivePerms, isLoading } = useQuery<EffectivePerm[]>({
    queryKey: ["/api/permissions/effective", selectedUserId],
    enabled: !!selectedUserId,
    queryFn: async () => {
      const res = await fetch(`/api/permissions/effective/${selectedUserId}`);
      if (!res.ok) throw new Error("Failed to fetch effective permissions");
      return res.json();
    },
  });

  const selectedUser = users.find(u => u.id === selectedUserId);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Search user</Label>
        <Input
          placeholder="Type to filter users..."
          value={searchUser}
          onChange={e => setSearchUser(e.target.value)}
          data-testid="input-search-user-inspector"
        />
      </div>
      <div className="space-y-1 max-h-48 overflow-y-auto border rounded-md p-1">
        {filteredUsers.map(u => (
          <button
            key={u.id}
            className={`w-full text-left px-3 py-2 rounded text-sm flex items-center gap-2 hover:bg-muted transition-colors ${selectedUserId === u.id ? "bg-muted font-medium" : ""}`}
            onClick={() => setSelectedUserId(u.id)}
            data-testid={`button-select-user-${u.id}`}
          >
            <User className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span className="truncate">{u.username}</span>
            <Badge variant="outline" className="ml-auto text-xs">{u.role}</Badge>
          </button>
        ))}
        {filteredUsers.length === 0 && (
          <p className="text-center text-sm text-muted-foreground py-3">No users found</p>
        )}
      </div>

      {selectedUser && (
        <div className="space-y-3">
          <Separator />
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-teal-600" />
            <span className="font-medium text-sm">Effective permissions for: <strong>{selectedUser.username}</strong></span>
          </div>
          <Badge variant="secondary">System role: {selectedUser.role}</Badge>

          {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
          {effectivePerms && (
            <ScrollArea className="h-64">
              <div className="space-y-2">
                {effectivePerms.length === 0 && (
                  <p className="text-sm text-muted-foreground">No permissions found</p>
                )}
                {effectivePerms.map(ep => (
                  <div key={ep.resource} className="border rounded-md p-2 space-y-1" data-testid={`perm-resource-${ep.resource}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium capitalize">{ep.resource}</span>
                      {ep.scope && <Badge variant="outline" className="text-xs">{ep.scope}</Badge>}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {ep.permissions.map(p => {
                        const meta = ALL_PERM_META.find(m => m.key === `can${p.split("_").map((s: string) => s.charAt(0).toUpperCase() + s.slice(1)).join("")}`);
                        return (
                          <span
                            key={p}
                            title={p}
                            className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-bold whitespace-nowrap ${meta?.color || "bg-gray-100 text-gray-600"}`}
                          >
                            {meta?.abbr || p[0].toUpperCase()}
                          </span>
                        );
                      })}
                    </div>
                    <p className="text-xs text-muted-foreground">via {ep.source}</p>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      )}
    </div>
  );
}

export default function PermissionsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [resourceSearch, setResourceSearch] = useState("");

  const { data: matrix, isLoading } = useQuery<MatrixData>({
    queryKey: ["/api/permissions/matrix"],
  });

  if (!user || (user.role !== "admin" && user.role !== "platform_super_admin")) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center space-y-2">
          <XCircle className="h-10 w-10 text-destructive mx-auto" />
          <p className="text-muted-foreground">You don't have access to this page.</p>
        </div>
      </div>
    );
  }

  const handleExportCsv = () => {
    window.open("/api/permissions/export-csv", "_blank");
    toast({ title: "Export started", description: "The CSV file will download shortly." });
  };

  const roles = matrix?.roles || [];
  const permissions = matrix?.permissions || [];
  const users = matrix?.users || [];
  const userRoles = matrix?.userRoles || [];

  const filteredRoles = roleFilter === "all" ? roles : roles.filter(r => r.id === roleFilter);

  const resourceSet = new Set(permissions.map(p => p.resource));
  const allResources = Array.from(resourceSet).sort();
  const filteredResources = resourceSearch
    ? allResources.filter(r => r.toLowerCase().includes(resourceSearch.toLowerCase()))
    : allResources;

  const getPermForCell = (roleId: string, resource: string) =>
    permissions.find(p => p.roleId === roleId && p.resource === resource);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Shield className="h-6 w-6 text-teal-600" />
            Permission Matrix
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            View and audit role-permission mappings across the platform
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" data-testid="button-open-inspector">
                <Users className="h-4 w-4 mr-2" />
                Inspect User
              </Button>
            </SheetTrigger>
            <SheetContent className="w-96">
              <SheetHeader>
                <SheetTitle>Effective Permissions Inspector</SheetTitle>
                <SheetDescription>
                  Select a user to see their computed access — role grants merged with any overrides.
                </SheetDescription>
              </SheetHeader>
              <div className="mt-4">
                <EffectivePermissionsPanel users={users} />
              </div>
            </SheetContent>
          </Sheet>
          <Button onClick={handleExportCsv} data-testid="button-export-csv">
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Legend */}
      <Card>
        <CardContent className="pt-4 pb-3 space-y-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider w-20">Flat:</span>
            {FLAT_PERMS.map(p => (
              <div key={p.key} className="flex items-center gap-1.5">
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-bold whitespace-nowrap ${p.color}`}>{p.abbr}</span>
                <span className="text-xs">{p.label}</span>
              </div>
            ))}
          </div>
          <Separator />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider w-20">Scope:</span>
            {SCOPE_PERMS.map(p => (
              <div key={p.key} className="flex items-center gap-1.5">
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${p.color}`}>{p.abbr}</span>
                <span className="text-xs">{p.label}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
            <span className="text-xs text-muted-foreground"><strong>own</strong> = self only</span>
            <span className="text-xs text-muted-foreground"><strong>subs</strong> = direct reports</span>
            <span className="text-xs text-muted-foreground"><strong>dept</strong> = department-wide</span>
            <span className="text-xs text-muted-foreground"><strong>co</strong> = entire company</span>
          </div>
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="flex items-end gap-3 flex-wrap">
        <div className="space-y-1 min-w-[200px]">
          <Label htmlFor="role-filter">Filter by Role</Label>
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger id="role-filter" data-testid="select-role-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Roles</SelectItem>
              {roles.map(role => (
                <SelectItem key={role.id} value={role.id}>{role.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1 flex-1 min-w-[220px]">
          <Label htmlFor="resource-search">Filter by Resource/Group</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              id="resource-search"
              placeholder="Search resources..."
              className="pl-9"
              value={resourceSearch}
              onChange={e => setResourceSearch(e.target.value)}
              data-testid="input-resource-search"
            />
          </div>
        </div>
      </div>

      {/* Matrix Grid */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Role × Resource Matrix</CardTitle>
          <CardDescription>
            {filteredResources.length} resources × {filteredRoles.length} roles shown
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-12 text-center text-muted-foreground">Loading matrix...</div>
          ) : filteredResources.length === 0 ? (
            <div className="py-12 text-center">
              <Shield className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-muted-foreground">
                {allResources.length === 0
                  ? "No permission groups configured yet."
                  : "No resources match your search."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="table-permission-matrix">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-3 font-semibold text-muted-foreground w-40 min-w-[140px]">Resource</th>
                    {filteredRoles.map(role => (
                      <th key={role.id} className="py-2 px-2 text-center font-semibold min-w-[120px]" data-testid={`col-role-${role.name}`}>
                        <div>{role.name}</div>
                        <div className="text-xs text-muted-foreground font-normal">Lvl {role.level}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredResources.map((resource, idx) => (
                    <tr key={resource} className={idx % 2 === 0 ? "bg-muted/30" : ""} data-testid={`row-resource-${resource}`}>
                      <td className="py-2 px-3 font-medium capitalize">{resource}</td>
                      {filteredRoles.map(role => (
                        <td key={role.id} className="py-2 px-2 text-center">
                          <CellPermissions perm={getPermForCell(role.id, resource)} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <Shield className="h-8 w-8 text-teal-600" />
              <div>
                <p className="text-2xl font-bold">{roles.length}</p>
                <p className="text-sm text-muted-foreground">Roles defined</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-8 w-8 text-green-600" />
              <div>
                <p className="text-2xl font-bold">{allResources.length}</p>
                <p className="text-sm text-muted-foreground">Resources mapped</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <Users className="h-8 w-8 text-blue-600" />
              <div>
                <p className="text-2xl font-bold">{userRoles.length}</p>
                <p className="text-sm text-muted-foreground">Role assignments</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
