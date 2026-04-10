import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Package, Plus, Pencil, Trash2, Search, Download, Upload, AlertTriangle, TrendingDown } from "lucide-react";

const STARTING_INVENTORY = [
  { name: "1 Gram DMT", quantity: 0 },
  { name: "DMT Vape (Cartridge Only)", quantity: 0 },
  { name: "DMT Vape", quantity: 0 },
  { name: "1 Gram T", quantity: 39 },
  { name: "1 oz BDO", quantity: 25 },
  { name: "2 oz BDO", quantity: 40 },
  { name: "Red Brick", quantity: 7 },
  { name: "Black Diamond", quantity: 10 },
  { name: "1 Gram Cocain", quantity: 3.5 },
  { name: "1 Gram Mushrooms", quantity: 1 },
  { name: "1 Watermellon Mushroom Gummie", quantity: 10 },
  { name: "1 Rasberry Mushroom Gummie", quantity: 10 },
  { name: "Mushroom Tea Bag", quantity: 1 },
  { name: "Mushroom Milk Chocolate", quantity: 1 },
  { name: "1/2 Gram Ketamine", quantity: 1 },
  { name: "1 Molly Pill", quantity: 20 },
  { name: "Oil Burning Bong Stem", quantity: 1 },
  { name: "Oil Burner", quantity: 2 },
  { name: "Butane Lighter", quantity: 2 },
  { name: "Tremedol", quantity: 6 },
  { name: "Amoxicilin", quantity: 4 },
  { name: "Doxycycline", quantity: 3 },
  { name: "Zinotram", quantity: 9 },
  { name: "Viagra", quantity: 7 },
  { name: "Flexerall", quantity: 5 },
  { name: "CASH", quantity: 60 },
  { name: "points", quantity: 3 },
];

interface InventoryItem {
  id: string;
  companyId: string;
  name: string;
  quantity: string;
  unit: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

function qty(v: string | number) {
  const n = parseFloat(String(v));
  return isNaN(n) ? 0 : n;
}

function qtyBadge(q: string) {
  const n = qty(q);
  if (n === 0) return <Badge variant="destructive" className="text-xs">Out of Stock</Badge>;
  if (n <= 3) return <Badge variant="outline" className="text-xs border-amber-400 text-amber-600">Low</Badge>;
  return <Badge variant="outline" className="text-xs border-teal-400 text-teal-600">{n}</Badge>;
}

type EditState = { name: string; quantity: string; unit: string; notes: string };

const EMPTY_EDIT: EditState = { name: "", quantity: "0", unit: "", notes: "" };

export default function InventoryPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isManager = ["admin", "manager", "tenant_admin", "tenant_owner", "tenant_hr_admin",
    "tenant_payroll_admin", "tenant_finance_admin", "tenant_manager", "tenant_supervisor"].includes(user?.role ?? "");

  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editItem, setEditItem] = useState<InventoryItem | null>(null);
  const [deleteItem, setDeleteItem] = useState<InventoryItem | null>(null);
  const [form, setForm] = useState<EditState>(EMPTY_EDIT);

  const { data: items = [], isLoading } = useQuery<InventoryItem[]>({
    queryKey: ["/api/inventory"],
  });

  const createMutation = useMutation({
    mutationFn: (data: Partial<EditState>) => apiRequest("POST", "/api/inventory", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      toast({ title: "Item added" });
      setAddOpen(false);
      setForm(EMPTY_EDIT);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<EditState> }) => apiRequest("PATCH", `/api/inventory/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      toast({ title: "Item updated" });
      setEditItem(null);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/inventory/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      toast({ title: "Item removed" });
      setDeleteItem(null);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const seedMutation = useMutation({
    mutationFn: async () => {
      for (const item of STARTING_INVENTORY) {
        await apiRequest("POST", "/api/inventory", { name: item.name, quantity: String(item.quantity) });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      toast({ title: "Starting inventory loaded" });
    },
    onError: (e: any) => toast({ title: "Error loading inventory", description: e.message, variant: "destructive" }),
  });

  const filtered = items.filter(i => i.name.toLowerCase().includes(search.toLowerCase()));

  const totalItems = items.length;
  const outOfStock = items.filter(i => qty(i.quantity) === 0).length;
  const lowStock = items.filter(i => qty(i.quantity) > 0 && qty(i.quantity) <= 3).length;
  const totalQty = items.reduce((sum, i) => sum + qty(i.quantity), 0);

  function openAdd() {
    setForm(EMPTY_EDIT);
    setAddOpen(true);
  }

  function openEdit(item: InventoryItem) {
    setForm({ name: item.name, quantity: String(qty(item.quantity)), unit: item.unit ?? "", notes: item.notes ?? "" });
    setEditItem(item);
  }

  function handleExportCsv() {
    const header = "Name,Quantity,Unit,Notes";
    const rows = items.map(i => `"${i.name.replace(/"/g, '""')}",${qty(i.quantity)},"${(i.unit ?? "").replace(/"/g, '""')}","${(i.notes ?? "").replace(/"/g, '""')}"`);
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `inventory-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-teal-100 dark:bg-teal-900/30">
            <Package className="h-6 w-6 text-teal-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Inventory</h1>
            <p className="text-sm text-muted-foreground">Track and manage product stock levels</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handleExportCsv} data-testid="button-export-csv">
            <Download className="h-4 w-4 mr-1" /> Export CSV
          </Button>
          {isManager && items.length === 0 && (
            <Button variant="outline" size="sm" onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending} data-testid="button-load-starting-inventory">
              <Upload className="h-4 w-4 mr-1" />
              {seedMutation.isPending ? "Loading..." : "Load Starting Inventory"}
            </Button>
          )}
          {isManager && (
            <Button size="sm" onClick={openAdd} data-testid="button-add-item">
              <Plus className="h-4 w-4 mr-1" /> Add Item
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Total Items</p>
            <p className="text-2xl font-bold" data-testid="text-total-items">{totalItems}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Total Units</p>
            <p className="text-2xl font-bold" data-testid="text-total-qty">{totalQty.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1">
              <TrendingDown className="h-3 w-3 text-amber-500" /> Low Stock
            </p>
            <p className="text-2xl font-bold text-amber-600" data-testid="text-low-stock">{lowStock}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3 text-red-500" /> Out of Stock
            </p>
            <p className="text-2xl font-bold text-red-600" data-testid="text-out-of-stock">{outOfStock}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search items..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9"
                data-testid="input-inventory-search"
              />
            </div>
            <span className="text-sm text-muted-foreground whitespace-nowrap">{filtered.length} item{filtered.length !== 1 ? "s" : ""}</span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <Package className="h-10 w-10 mx-auto mb-3 opacity-30" />
              {items.length === 0 ? (
                <>
                  <p className="font-medium mb-1">No inventory yet</p>
                  {isManager && (
                    <p className="text-sm">Click <span className="font-semibold">Load Starting Inventory</span> to populate from the default list, or add items manually.</p>
                  )}
                </>
              ) : (
                <p>No items match your search.</p>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item Name</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead>Status</TableHead>
                  {isManager && <TableHead className="w-20 text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(item => (
                  <TableRow key={item.id} data-testid={`row-inventory-${item.id}`} className="group">
                    <TableCell className="font-medium" data-testid={`text-item-name-${item.id}`}>{item.name}</TableCell>
                    <TableCell className="text-right tabular-nums font-mono" data-testid={`text-item-qty-${item.id}`}>
                      {qty(item.quantity).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{item.unit ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground text-sm max-w-xs truncate">{item.notes ?? "—"}</TableCell>
                    <TableCell>{qtyBadge(item.quantity)}</TableCell>
                    {isManager && (
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(item)} data-testid={`button-edit-${item.id}`}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteItem(item)} data-testid={`button-delete-${item.id}`}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add Item Dialog */}
      <Dialog open={addOpen} onOpenChange={open => { if (!open) setAddOpen(false); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Inventory Item</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="add-name">Item Name *</Label>
              <Input
                id="add-name"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. 1 Gram T"
                data-testid="input-add-name"
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="add-qty">Quantity *</Label>
                <Input
                  id="add-qty"
                  type="number"
                  step="0.01"
                  value={form.quantity}
                  onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
                  data-testid="input-add-quantity"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="add-unit">Unit</Label>
                <Input
                  id="add-unit"
                  value={form.unit}
                  onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
                  placeholder="e.g. g, oz, pills"
                  data-testid="input-add-unit"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-notes">Notes</Label>
              <Input
                id="add-notes"
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Optional notes"
                data-testid="input-add-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} data-testid="button-cancel-add">Cancel</Button>
            <Button
              onClick={() => createMutation.mutate(form)}
              disabled={!form.name.trim() || createMutation.isPending}
              data-testid="button-confirm-add"
            >
              {createMutation.isPending ? "Adding..." : "Add Item"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Item Dialog */}
      <Dialog open={!!editItem} onOpenChange={open => { if (!open) setEditItem(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Inventory Item</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-name">Item Name *</Label>
              <Input
                id="edit-name"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                data-testid="input-edit-name"
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-qty">Quantity *</Label>
                <Input
                  id="edit-qty"
                  type="number"
                  step="0.01"
                  value={form.quantity}
                  onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
                  data-testid="input-edit-quantity"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-unit">Unit</Label>
                <Input
                  id="edit-unit"
                  value={form.unit}
                  onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
                  placeholder="e.g. g, oz, pills"
                  data-testid="input-edit-unit"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-notes">Notes</Label>
              <Input
                id="edit-notes"
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Optional notes"
                data-testid="input-edit-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditItem(null)} data-testid="button-cancel-edit">Cancel</Button>
            <Button
              onClick={() => editItem && updateMutation.mutate({ id: editItem.id, data: form })}
              disabled={!form.name.trim() || updateMutation.isPending}
              data-testid="button-confirm-edit"
            >
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteItem} onOpenChange={open => { if (!open) setDeleteItem(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Item</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove <span className="font-semibold">{deleteItem?.name}</span> from inventory? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => deleteItem && deleteMutation.mutate(deleteItem.id)}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? "Removing..." : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
