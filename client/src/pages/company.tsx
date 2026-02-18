import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Building2,
  Plus,
  MapPin,
  Phone,
  Hash,
  Pencil,
  MoreHorizontal,
  Clock,
  DollarSign,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Company } from "@shared/schema";

const companyFormSchema = z.object({
  name: z.string().min(1, "Company name is required"),
  legalName: z.string().optional(),
  ein: z.string().optional(),
  entityType: z.enum(["c_corp", "s_corp", "llc", "sole_prop", "nonprofit_501c3", "partnership"]).default("llc"),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  phone: z.string().optional(),
  payFrequency: z.enum(["weekly", "biweekly", "semimonthly", "monthly"]).default("biweekly"),
  overtimeThreshold: z.number().min(0).default(40),
  overtimeMultiplier: z.string().default("1.5"),
  breakPolicyMinutes: z.number().min(0).default(30),
  breakAfterHours: z.number().min(0).default(6),
  timeRoundingMinutes: z.number().min(0).default(15),
});

type CompanyFormValues = z.infer<typeof companyFormSchema>;

const entityTypeLabels: Record<string, string> = {
  c_corp: "C-Corporation",
  s_corp: "S-Corporation",
  llc: "LLC",
  sole_prop: "Sole Proprietorship",
  nonprofit_501c3: "501(c)(3) Non-profit",
  partnership: "Partnership",
};

function CompanyFormFields({ form }: { form: any }) {
  return (
    <>
      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Company Name</FormLabel>
            <FormControl>
              <Input {...field} data-testid="input-company-name" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="legalName"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Legal Name</FormLabel>
            <FormControl>
              <Input {...field} data-testid="input-legal-name" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <div className="grid grid-cols-2 gap-3">
        <FormField
          control={form.control}
          name="ein"
          render={({ field }) => (
            <FormItem>
              <FormLabel>EIN</FormLabel>
              <FormControl>
                <Input placeholder="XX-XXXXXXX" {...field} data-testid="input-ein" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="entityType"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Entity Type</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger data-testid="select-entity-type">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {Object.entries(entityTypeLabels).map(([val, label]) => (
                    <SelectItem key={val} value={val}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
      <FormField
        control={form.control}
        name="address"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Address</FormLabel>
            <FormControl>
              <Input {...field} data-testid="input-address" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <div className="grid grid-cols-3 gap-3">
        <FormField
          control={form.control}
          name="city"
          render={({ field }) => (
            <FormItem>
              <FormLabel>City</FormLabel>
              <FormControl>
                <Input {...field} data-testid="input-city" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="state"
          render={({ field }) => (
            <FormItem>
              <FormLabel>State</FormLabel>
              <FormControl>
                <Input {...field} data-testid="input-state" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="zip"
          render={({ field }) => (
            <FormItem>
              <FormLabel>ZIP</FormLabel>
              <FormControl>
                <Input {...field} data-testid="input-zip" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FormField
          control={form.control}
          name="phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Phone</FormLabel>
              <FormControl>
                <Input {...field} data-testid="input-company-phone" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="payFrequency"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Pay Frequency</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger data-testid="select-pay-frequency">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="biweekly">Biweekly</SelectItem>
                  <SelectItem value="semimonthly">Semimonthly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <div className="border-t pt-4 mt-2">
        <p className="text-sm font-medium mb-3">Company Policies</p>
        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="overtimeThreshold"
            render={({ field }) => (
              <FormItem>
                <FormLabel>OT Threshold (hrs/week)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    {...field}
                    onChange={e => field.onChange(Number(e.target.value))}
                    data-testid="input-ot-threshold"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="overtimeMultiplier"
            render={({ field }) => (
              <FormItem>
                <FormLabel>OT Multiplier</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="0.1"
                    {...field}
                    data-testid="input-ot-multiplier"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <FormField
            control={form.control}
            name="breakPolicyMinutes"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Break Duration (min)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    {...field}
                    onChange={e => field.onChange(Number(e.target.value))}
                    data-testid="input-break-minutes"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="breakAfterHours"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Break After (hrs)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    {...field}
                    onChange={e => field.onChange(Number(e.target.value))}
                    data-testid="input-break-after-hours"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <div className="mt-3">
          <FormField
            control={form.control}
            name="timeRoundingMinutes"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Time Rounding (min)</FormLabel>
                <Select onValueChange={(v) => field.onChange(Number(v))} value={String(field.value)}>
                  <FormControl>
                    <SelectTrigger data-testid="select-time-rounding">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="5">5 minutes</SelectItem>
                    <SelectItem value="6">6 minutes</SelectItem>
                    <SelectItem value="15">15 minutes (quarter-hour)</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </div>
    </>
  );
}

function EditCompanyDialog({ company, onClose }: { company: Company; onClose: () => void }) {
  const { toast } = useToast();

  const form = useForm<CompanyFormValues>({
    resolver: zodResolver(companyFormSchema),
    defaultValues: {
      name: company.name,
      legalName: company.legalName || "",
      ein: company.ein || "",
      entityType: (company.entityType as any) || "llc",
      address: company.address || "",
      city: company.city || "",
      state: company.state || "",
      zip: company.zip || "",
      phone: company.phone || "",
      payFrequency: (company.payFrequency as any) || "biweekly",
      overtimeThreshold: company.overtimeThreshold ?? 40,
      overtimeMultiplier: String(company.overtimeMultiplier ?? "1.5"),
      breakPolicyMinutes: company.breakPolicyMinutes ?? 30,
      breakAfterHours: company.breakAfterHours ?? 6,
      timeRoundingMinutes: company.timeRoundingMinutes ?? 15,
    },
  });

  const updateCompany = useMutation({
    mutationFn: async (data: CompanyFormValues) => {
      await apiRequest("PATCH", `/api/companies/${company.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({ title: "Company updated" });
      onClose();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  return (
    <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Edit Company</DialogTitle>
      </DialogHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit((data) => updateCompany.mutate(data))} className="space-y-4">
          <CompanyFormFields form={form} />
          <Button
            type="submit"
            className="w-full"
            disabled={updateCompany.isPending}
            data-testid="button-submit-edit-company"
          >
            {updateCompany.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </form>
      </Form>
    </DialogContent>
  );
}

function CompanyCard({ company, onEdit }: { company: Company; onEdit: (c: Company) => void }) {
  return (
    <Card className="hover-elevate" data-testid={`card-company-${company.id}`}>
      <CardContent className="p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-primary/10 p-2.5 shrink-0">
            <Building2 className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold">{company.name}</h3>
              <Badge variant="secondary" className="text-xs">
                {entityTypeLabels[company.entityType || "llc"] || company.entityType}
              </Badge>
            </div>
            {company.legalName && company.legalName !== company.name && (
              <p className="text-xs text-muted-foreground mt-0.5">{company.legalName}</p>
            )}
            <div className="flex flex-col gap-1 mt-2">
              {company.ein && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Hash className="h-3 w-3" /> EIN: {company.ein}
                </span>
              )}
              {(company.city || company.state) && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <MapPin className="h-3 w-3" /> {[company.city, company.state].filter(Boolean).join(", ")}
                </span>
              )}
              {company.phone && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Phone className="h-3 w-3" /> {company.phone}
                </span>
              )}
            </div>
            <div className="flex items-center gap-4 mt-2 flex-wrap">
              <span className="text-xs text-muted-foreground capitalize flex items-center gap-1">
                <DollarSign className="h-3 w-3" />
                Pay: {company.payFrequency?.replace("_", "-") || "Biweekly"}
              </span>
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                OT: {company.overtimeThreshold || 40}hrs @ {company.overtimeMultiplier || "1.5"}x
              </span>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" data-testid={`button-company-menu-${company.id}`}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => onEdit(company)}
                data-testid={`button-edit-company-${company.id}`}
              >
                <Pencil className="h-4 w-4 mr-2" /> Edit
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  );
}

export default function CompanyPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const { toast } = useToast();

  const { data: companies, isLoading } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
  });

  const form = useForm<CompanyFormValues>({
    resolver: zodResolver(companyFormSchema),
    defaultValues: {
      name: "",
      legalName: "",
      ein: "",
      entityType: "llc",
      address: "",
      city: "",
      state: "",
      zip: "",
      phone: "",
      payFrequency: "biweekly",
      overtimeThreshold: 40,
      overtimeMultiplier: "1.5",
      breakPolicyMinutes: 30,
      breakAfterHours: 6,
      timeRoundingMinutes: 15,
    },
  });

  const createCompany = useMutation({
    mutationFn: async (data: CompanyFormValues) => {
      await apiRequest("POST", "/api/companies", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({ title: "Company created" });
      form.reset();
      setDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-company-title">
            Companies
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your business entities, payroll settings, and policies.
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-company">
              <Plus className="h-4 w-4 mr-2" /> Add Company
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add Company</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit((data) => createCompany.mutate(data))}
                className="space-y-4"
              >
                <CompanyFormFields form={form} />
                <Button
                  type="submit"
                  className="w-full"
                  disabled={createCompany.isPending}
                  data-testid="button-submit-company"
                >
                  {createCompany.isPending ? "Creating..." : "Create Company"}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2].map((i) => (
            <Card key={i}>
              <CardContent className="p-5">
                <div className="flex items-start gap-3">
                  <Skeleton className="h-10 w-10 rounded-md" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-3 w-40" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (companies || []).length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Building2 className="h-12 w-12 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No companies yet</p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Add your first company to get started with PayLink.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(companies || []).map((company) => (
            <CompanyCard key={company.id} company={company} onEdit={setEditingCompany} />
          ))}
        </div>
      )}

      <Dialog open={!!editingCompany} onOpenChange={(open) => !open && setEditingCompany(null)}>
        {editingCompany && (
          <EditCompanyDialog company={editingCompany} onClose={() => setEditingCompany(null)} />
        )}
      </Dialog>
    </div>
  );
}
