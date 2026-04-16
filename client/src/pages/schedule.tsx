import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useTimeFormat, formatShiftTime, formatShiftRange } from "@/hooks/use-time-format";
import type { Schedule, Worker, Company, RecurringSchedule, ShiftOffer, Department } from "@shared/schema";
import { isManagerOrAbove } from "@/lib/roles";
import { useFeatureFlag } from "@/lib/featureFlags";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Plus,
  Clock,
  RefreshCw,
  Settings,
  Printer,
  Search,
  Pencil,
  Trash2,
  Download,
  X,
  TrendingUp,
  Send,
  AlertTriangle,
  CheckCircle2,
  XCircle,
} from "lucide-react";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function formatDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatShortDate(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function getWeekDates(baseDate: Date): Date[] {
  const start = new Date(baseDate);
  const day = start.getDay();
  start.setDate(start.getDate() - day);
  const dates: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    dates.push(d);
  }
  return dates;
}

function getMonthDates(baseDate: Date): Date[] {
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const dates: Date[] = [];
  for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) {
    dates.push(new Date(d));
  }
  return dates;
}

function getDayDates(baseDate: Date): Date[] {
  return [new Date(baseDate)];
}

function parseTimeToHours(startTime: string, endTime: string): number {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  let hours = (eh * 60 + em - sh * 60 - sm) / 60;
  if (hours < 0) hours += 24;
  return Math.round(hours * 100) / 100;
}

function getWorkerName(workers: Worker[], workerId: string): string {
  const w = workers.find((w) => w.id === workerId);
  return w ? `${w.lastName}, ${w.firstName}` : "Unknown";
}

function useTabParam(defaultTab: string): [string, (tab: string) => void] {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(search);
  const tab = params.get("tab") || defaultTab;
  const setTab = (newTab: string) => {
    setLocation(`/app/schedule?tab=${newTab}`);
  };
  return [tab, setTab];
}

type ViewMode = "day" | "week" | "month";

const RESPONSIBILITY_POLICY = "Scheduled shifts remain the responsibility of the originally assigned employee or contractor unless and until the shift has been accepted by an eligible replacement and fully approved by an authorized supervisor or manager.";

function MarketplaceSection({ workers, schedules, companies, departments, currentUser, isAdminOrManager, shiftOffers, claimOfferMutation, approveOfferMutation, rejectOfferMutation, withdrawOfferMutation, setRejectOfferId, setRejectNote, setRejectDialogOpen }: any) {
  const [marketplaceSubTab, setMarketplaceSubTab] = useState("available");
  const [postDialogOpen, setPostDialogOpen] = useState(false);
  const [ackResponsibility, setAckResponsibility] = useState(false);
  const [postForm, setPostForm] = useState({ scheduleId: "", reason: "", urgency: "normal", emergencyCoverage: false, listingType: "offer" });
  const [requestDialogOpen, setRequestDialogOpen] = useState(false);
  const [requestListingId, setRequestListingId] = useState<string | null>(null);
  const [requestNote, setRequestNote] = useState("");
  const { toast } = useToast();

  const { data: marketplaceListings = [], refetch: refetchListings } = useQuery<any[]>({
    queryKey: ["/api/marketplace/listings"],
    queryFn: async () => {
      const res = await fetch("/api/marketplace/listings", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: marketplaceRequests = [] } = useQuery<any[]>({
    queryKey: ["/api/marketplace/requests"],
    queryFn: async () => {
      const res = await fetch("/api/marketplace/requests", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: auditLogs = [] } = useQuery<any[]>({
    queryKey: ["/api/schedule-audit-logs"],
    queryFn: async () => {
      const res = await fetch("/api/schedule-audit-logs?limit=50", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: isAdminOrManager,
  });

  const postListingMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await fetch("/api/marketplace/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to post");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Shift posted to marketplace" });
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace/listings"] });
      setPostDialogOpen(false);
      setAckResponsibility(false);
      setPostForm({ scheduleId: "", reason: "", urgency: "normal", emergencyCoverage: false, listingType: "offer" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const requestShiftMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await fetch("/api/marketplace/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to request");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Shift request submitted for approval" });
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace/requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace/listings"] });
      setRequestDialogOpen(false);
      setRequestNote("");
    },
    onError: (e: any) => toast({ title: "Not Eligible", description: e.message, variant: "destructive" }),
  });

  const reviewRequestMutation = useMutation({
    mutationFn: async ({ requestId, decision, reviewNote }: { requestId: string; decision: string; reviewNote?: string }) => {
      const res = await fetch(`/api/marketplace/requests/${requestId}/review`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ decision, reviewNote }),
      });
      if (!res.ok) throw new Error("Failed to review");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Request reviewed" });
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace/requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace/listings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
    },
    onError: (e: any) => toast({ title: "Review failed", description: e.message, variant: "destructive" }),
  });

  const withdrawListingMutation = useMutation({
    mutationFn: async (listingId: string) => {
      const res = await fetch(`/api/marketplace/listings/${listingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: "withdrawn", withdrawnAt: new Date().toISOString(), withdrawnReason: "Withdrawn by user" }),
      });
      if (!res.ok) throw new Error("Failed to withdraw");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Listing withdrawn" });
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace/listings"] });
    },
  });

  const myWorkerSchedules = currentUser?.workerId
    ? schedules.filter((s: any) => s.workerId === currentUser.workerId && s.status === "published" && s.date >= new Date().toISOString().split("T")[0])
    : [];

  const openListings = marketplaceListings.filter((l: any) => l.status === "open");
  const myListings = currentUser?.workerId ? marketplaceListings.filter((l: any) => l.listedByWorkerId === currentUser.workerId) : [];
  const myRequests = currentUser?.workerId ? marketplaceRequests.filter((r: any) => r.requestingWorkerId === currentUser.workerId) : [];
  const pendingApprovals = marketplaceRequests.filter((r: any) => r.status === "pending");

  const urgencyBadge = (u: string) => {
    if (u === "critical") return <Badge variant="destructive">Critical</Badge>;
    if (u === "urgent") return <Badge className="bg-orange-500 text-white">Urgent</Badge>;
    return <Badge variant="outline">Normal</Badge>;
  };

  return (
    <>
      <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4 mb-4" data-testid="marketplace-responsibility-policy">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Shift Responsibility Policy</p>
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">{RESPONSIBILITY_POLICY}</p>
          </div>
        </div>
      </div>

      <Tabs value={marketplaceSubTab} onValueChange={setMarketplaceSubTab}>
        <div className="overflow-x-auto -mx-1 px-1">
        <TabsList className="inline-flex w-max">
          <TabsTrigger value="available" data-testid="subtab-available">
            Available Shifts {openListings.length > 0 && <Badge className="ml-1" variant="secondary">{openListings.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="my-posted" data-testid="subtab-my-posted">My Posted</TabsTrigger>
          <TabsTrigger value="my-requests" data-testid="subtab-my-requests">My Requests</TabsTrigger>
          {isAdminOrManager && <TabsTrigger value="approvals" data-testid="subtab-approvals">
            Approvals {pendingApprovals.length > 0 && <Badge className="ml-1" variant="destructive">{pendingApprovals.length}</Badge>}
          </TabsTrigger>}
          {isAdminOrManager && <TabsTrigger value="legacy" data-testid="subtab-legacy">Legacy Offers</TabsTrigger>}
          {isAdminOrManager && <TabsTrigger value="audit-log" data-testid="subtab-audit-log">Audit Log</TabsTrigger>}
        </TabsList>
        </div>

        <TabsContent value="available" className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Available Marketplace Shifts</h3>
            <Button onClick={() => setPostDialogOpen(true)} data-testid="button-post-shift">
              <Plus className="h-4 w-4 mr-1" /> Post a Shift
            </Button>
          </div>
          {openListings.length === 0 ? (
            <Card><CardContent className="text-center py-12 text-muted-foreground">
              <RefreshCw className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No available marketplace shifts</p>
              <p className="text-sm mt-1">When employees post shifts for pickup, they will appear here.</p>
            </CardContent></Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {openListings.map((listing: any) => {
                const sched = schedules.find((s: any) => s.id === listing.scheduleId);
                const lister = workers.find((w: any) => w.id === listing.listedByWorkerId);
                const co = companies.find((c: any) => c.id === listing.companyId);
                return (
                  <Card key={listing.id} className={`${listing.emergencyCoverage ? "border-red-300 dark:border-red-700" : ""}`} data-testid={`card-listing-${listing.id}`}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm">{sched?.date || "—"}</CardTitle>
                        {urgencyBadge(listing.urgency)}
                      </div>
                      {listing.emergencyCoverage && <Badge variant="destructive" className="w-fit text-xs">Emergency Coverage</Badge>}
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div className="text-sm">
                        <span className="font-medium">{sched ? formatShiftRange(sched.startTime, sched.endTime, timeFormat) : "—"}</span>
                        <span className="text-muted-foreground ml-2">({sched ? parseTimeToHours(sched.startTime, sched.endTime) : 0}h)</span>
                      </div>
                      <div className="text-xs text-muted-foreground space-y-0.5">
                        <div>Posted by: {lister ? `${lister.firstName} ${lister.lastName}` : "—"}</div>
                        <div>Company: {co?.name || "—"}</div>
                        {sched?.department && <div>Department: {sched.department}</div>}
                        {listing.reason && <div>Reason: {listing.reason}</div>}
                      </div>
                      <div className="bg-amber-50 dark:bg-amber-950/30 rounded p-2 text-[10px] text-amber-700 dark:text-amber-400">
                        This shift remains the responsibility of {lister?.firstName || "the original worker"} until approved.
                      </div>
                      {currentUser?.workerId && currentUser.workerId !== listing.listedByWorkerId && (
                        <Button size="sm" className="w-full" onClick={() => { setRequestListingId(listing.id); setRequestNote(""); setRequestDialogOpen(true); }} data-testid={`button-request-${listing.id}`}>
                          Request This Shift
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="my-posted" className="space-y-4">
          <h3 className="text-lg font-semibold">My Posted Shifts</h3>
          {myListings.length === 0 ? (
            <Card><CardContent className="text-center py-8 text-muted-foreground">No posted shifts.</CardContent></Card>
          ) : (
            <div className="overflow-x-auto"><Table data-testid="table-my-listings">
              <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Time</TableHead><TableHead>Status</TableHead><TableHead>Urgency</TableHead><TableHead>Requests</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {myListings.map((listing: any) => {
                  const sched = schedules.find((s: any) => s.id === listing.scheduleId);
                  const reqCount = marketplaceRequests.filter((r: any) => r.listingId === listing.id).length;
                  return (
                    <TableRow key={listing.id} data-testid={`row-my-listing-${listing.id}`}>
                      <TableCell>{sched?.date || "—"}</TableCell>
                      <TableCell>{sched ? formatShiftRange(sched.startTime, sched.endTime, timeFormat) : "—"}</TableCell>
                      <TableCell><Badge variant={listing.status === "open" ? "outline" : listing.status === "filled" ? "default" : "secondary"}>{listing.status}</Badge></TableCell>
                      <TableCell>{urgencyBadge(listing.urgency)}</TableCell>
                      <TableCell>{reqCount} request(s)</TableCell>
                      <TableCell>
                        {listing.status === "open" && (
                          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => withdrawListingMutation.mutate(listing.id)} data-testid={`button-withdraw-listing-${listing.id}`}>
                            Withdraw
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table></div>
          )}
        </TabsContent>

        <TabsContent value="my-requests" className="space-y-4">
          <h3 className="text-lg font-semibold">My Requests</h3>
          {myRequests.length === 0 ? (
            <Card><CardContent className="text-center py-8 text-muted-foreground">No shift requests.</CardContent></Card>
          ) : (
            <div className="overflow-x-auto"><Table data-testid="table-my-requests">
              <TableHeader><TableRow><TableHead>Listing</TableHead><TableHead>Status</TableHead><TableHead>Note</TableHead><TableHead>Reviewed By</TableHead></TableRow></TableHeader>
              <TableBody>
                {myRequests.map((req: any) => {
                  const listing = marketplaceListings.find((l: any) => l.id === req.listingId);
                  const sched = listing ? schedules.find((s: any) => s.id === listing.scheduleId) : null;
                  return (
                    <TableRow key={req.id} data-testid={`row-my-request-${req.id}`}>
                      <TableCell>{sched ? `${sched.date} ${formatShiftRange(sched.startTime, sched.endTime, timeFormat)}` : req.listingId}</TableCell>
                      <TableCell><Badge variant={req.status === "pending" ? "outline" : req.status === "approved" ? "default" : "destructive"}>{req.status}</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground">{req.note || "—"}</TableCell>
                      <TableCell className="text-sm">{req.reviewNote || "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table></div>
          )}
        </TabsContent>

        {isAdminOrManager && (
          <TabsContent value="approvals" className="space-y-4">
            <h3 className="text-lg font-semibold">Pending Approvals</h3>
            {pendingApprovals.length === 0 ? (
              <Card><CardContent className="text-center py-8 text-muted-foreground">No pending approvals.</CardContent></Card>
            ) : (
              <div className="space-y-3">
                {pendingApprovals.map((req: any) => {
                  const listing = marketplaceListings.find((l: any) => l.id === req.listingId);
                  const sched = listing ? schedules.find((s: any) => s.id === listing.scheduleId) : null;
                  const requester = workers.find((w: any) => w.id === req.requestingWorkerId);
                  const original = listing ? workers.find((w: any) => w.id === listing.listedByWorkerId) : null;
                  let eligibility: any = null;
                  try { eligibility = req.eligibilitySnapshotJson ? JSON.parse(req.eligibilitySnapshotJson) : null; } catch {}

                  return (
                    <Card key={req.id} data-testid={`card-approval-${req.id}`}>
                      <CardContent className="pt-4">
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="font-medium">{requester ? `${requester.firstName} ${requester.lastName}` : "Unknown"} wants to pick up shift</p>
                            <p className="text-sm text-muted-foreground">
                              {sched ? `${sched.date} ${formatShiftRange(sched.startTime, sched.endTime, timeFormat)}` : "—"} — originally assigned to {original ? `${original.firstName} ${original.lastName}` : "—"}
                            </p>
                            {req.note && <p className="text-sm mt-1">Note: {req.note}</p>}
                            {eligibility && (
                              <div className="mt-2 text-xs space-y-0.5">
                                {eligibility.reasons?.map((r: string, i: number) => (
                                  <div key={i} className="text-green-600 dark:text-green-400">✓ {r}</div>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="flex gap-2">
                            <Button size="sm" onClick={() => reviewRequestMutation.mutate({ requestId: req.id, decision: "approved" })} data-testid={`button-approve-request-${req.id}`}>
                              <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Approve
                            </Button>
                            <Button size="sm" variant="destructive" onClick={() => reviewRequestMutation.mutate({ requestId: req.id, decision: "denied" })} data-testid={`button-deny-request-${req.id}`}>
                              <XCircle className="h-3.5 w-3.5 mr-1" /> Deny
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>
        )}

        {isAdminOrManager && (
          <TabsContent value="legacy" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Legacy Shift Offers</CardTitle>
                <p className="text-xs text-muted-foreground">These are from the original shift_offers table (pre-marketplace).</p>
              </CardHeader>
              <CardContent>
                {shiftOffers.length === 0 ? (
                  <p className="text-center text-muted-foreground py-4">No legacy offers.</p>
                ) : (
                  <div className="overflow-x-auto"><Table data-testid="table-legacy-offers">
                    <TableHeader><TableRow><TableHead>Offered By</TableHead><TableHead>Date</TableHead><TableHead>Time</TableHead><TableHead>Status</TableHead><TableHead>Claimed By</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {shiftOffers.map((offer: any) => {
                        const sched = schedules.find((s: any) => s.id === offer.scheduleId);
                        return (
                          <TableRow key={offer.id} data-testid={`row-legacy-${offer.id}`}>
                            <TableCell>{getWorkerName(workers, offer.offeredByWorkerId)}</TableCell>
                            <TableCell>{sched?.date || "—"}</TableCell>
                            <TableCell>{sched ? formatShiftRange(sched.startTime, sched.endTime, timeFormat) : "—"}</TableCell>
                            <TableCell><Badge variant={offer.status === "open" ? "outline" : offer.status === "approved" ? "default" : "secondary"}>{offer.status}</Badge></TableCell>
                            <TableCell>{offer.claimedByWorkerId ? getWorkerName(workers, offer.claimedByWorkerId) : "—"}</TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                {offer.status === "open" && currentUser?.workerId !== offer.offeredByWorkerId && (
                                  <Button size="sm" variant="outline" onClick={() => currentUser?.workerId && claimOfferMutation.mutate({ offerId: offer.id, workerId: currentUser.workerId })} data-testid={`button-claim-${offer.id}`}>Claim</Button>
                                )}
                                {offer.status === "claimed" && isAdminOrManager && (
                                  <>
                                    <Button size="sm" onClick={() => approveOfferMutation.mutate(offer.id)} data-testid={`button-approve-${offer.id}`}>Approve</Button>
                                    <Button size="sm" variant="destructive" onClick={() => { setRejectOfferId(offer.id); setRejectNote(""); setRejectDialogOpen(true); }} data-testid={`button-reject-${offer.id}`}>Reject</Button>
                                  </>
                                )}
                                {(offer.status === "open" || offer.status === "claimed") && (
                                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => withdrawOfferMutation.mutate(offer.id)} data-testid={`button-withdraw-${offer.id}`}>Withdraw</Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table></div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {isAdminOrManager && (
          <TabsContent value="audit-log" className="space-y-4">
            <h3 className="text-lg font-semibold">Schedule Audit Log</h3>
            {auditLogs.length === 0 ? (
              <Card><CardContent className="text-center py-8 text-muted-foreground">No audit entries yet.</CardContent></Card>
            ) : (
              <div className="overflow-x-auto"><Table data-testid="table-audit-log">
                <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Action</TableHead><TableHead>Object</TableHead><TableHead>Actor</TableHead></TableRow></TableHeader>
                <TableBody>
                  {auditLogs.map((log: any) => (
                    <TableRow key={log.id} data-testid={`row-audit-${log.id}`}>
                      <TableCell className="text-xs">{log.createdAt ? new Date(log.createdAt).toLocaleString() : "—"}</TableCell>
                      <TableCell><Badge variant="outline">{log.actionType}</Badge></TableCell>
                      <TableCell className="text-xs">{log.objectType} {log.objectId?.substring(0, 8)}</TableCell>
                      <TableCell className="text-xs">{log.actorUserId?.substring(0, 8) || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table></div>
            )}
          </TabsContent>
        )}
      </Tabs>

      <Dialog open={postDialogOpen} onOpenChange={(v) => { setPostDialogOpen(v); if (!v) { setAckResponsibility(false); setPostForm({ scheduleId: "", reason: "", urgency: "normal", emergencyCoverage: false, listingType: "offer" }); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Post Shift to Marketplace</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded p-3">
              <p className="text-xs text-amber-700 dark:text-amber-400">{RESPONSIBILITY_POLICY}</p>
              <label className="flex items-center gap-2 mt-3 text-sm cursor-pointer">
                <input type="checkbox" checked={ackResponsibility} onChange={e => setAckResponsibility(e.target.checked)} data-testid="checkbox-acknowledge" />
                I acknowledge and understand this policy
              </label>
            </div>
            <div>
              <Label>Select Shift</Label>
              <Select value={postForm.scheduleId} onValueChange={v => setPostForm(f => ({ ...f, scheduleId: v }))}>
                <SelectTrigger data-testid="select-post-shift"><SelectValue placeholder="Choose a shift" /></SelectTrigger>
                <SelectContent>
                  {myWorkerSchedules.map((s: any) => (
                    <SelectItem key={s.id} value={s.id}>{s.date} {formatShiftRange(s.startTime, s.endTime, timeFormat)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Urgency</Label>
              <Select value={postForm.urgency} onValueChange={v => setPostForm(f => ({ ...f, urgency: v }))}>
                <SelectTrigger data-testid="select-post-urgency"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Reason (optional)</Label>
              <Textarea value={postForm.reason} onChange={e => setPostForm(f => ({ ...f, reason: e.target.value }))} placeholder="Why are you posting this shift?" data-testid="input-post-reason" rows={2} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={postForm.emergencyCoverage} onChange={e => setPostForm(f => ({ ...f, emergencyCoverage: e.target.checked }))} data-testid="checkbox-emergency" />
              Emergency coverage needed
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPostDialogOpen(false)}>Cancel</Button>
            <Button
              disabled={!ackResponsibility || !postForm.scheduleId || postListingMutation.isPending}
              data-testid="button-confirm-post"
              onClick={() => {
                const sched = schedules.find((s: any) => s.id === postForm.scheduleId);
                if (!sched || !currentUser?.workerId) return;
                postListingMutation.mutate({
                  scheduleId: postForm.scheduleId,
                  companyId: sched.companyId,
                  listedByWorkerId: currentUser.workerId,
                  listingType: postForm.listingType,
                  reason: postForm.reason || null,
                  urgency: postForm.urgency,
                  emergencyCoverage: postForm.emergencyCoverage,
                  employeeAcknowledgedResponsibility: true,
                });
              }}
            >
              {postListingMutation.isPending ? "Posting..." : "Post to Marketplace"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={requestDialogOpen} onOpenChange={(v) => { setRequestDialogOpen(v); if (!v) { setRequestListingId(null); setRequestNote(""); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Request Shift Pickup</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Your eligibility will be checked automatically. A manager must approve the exchange before it is final.</p>
            <div>
              <Label>Note (optional)</Label>
              <Textarea value={requestNote} onChange={e => setRequestNote(e.target.value)} placeholder="Add a note for the manager..." data-testid="input-request-note" rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRequestDialogOpen(false)}>Cancel</Button>
            <Button
              disabled={!requestListingId || !currentUser?.workerId || requestShiftMutation.isPending}
              data-testid="button-confirm-request"
              onClick={() => {
                if (requestListingId && currentUser?.workerId) {
                  requestShiftMutation.mutate({
                    listingId: requestListingId,
                    requestingWorkerId: currentUser.workerId,
                    requestType: "pickup",
                    note: requestNote || null,
                  });
                }
              }}
            >
              {requestShiftMutation.isPending ? "Checking Eligibility..." : "Submit Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function SchedulePage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const timeFormat = useTimeFormat();
  const isAdminOrManager = isManagerOrAbove(user?.role || "");
  const marketplaceEnabled = useFeatureFlag("tenant.schedule.marketplace");
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useTabParam("schedules");
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [dateOffset, setDateOffset] = useState(0);
  const [selectedCompany, setSelectedCompany] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showDailyTotals, setShowDailyTotals] = useState(true);
  const [showWeeklyTotals, setShowWeeklyTotals] = useState(false);
  const [showUnscheduled, setShowUnscheduled] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [showLaborCosts, setShowLaborCosts] = useState(false);
  const [addScheduleOpen, setAddScheduleOpen] = useState(false);
  const [editScheduleOpen, setEditScheduleOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [addRecurringOpen, setAddRecurringOpen] = useState(false);
  const [editRecurringOpen, setEditRecurringOpen] = useState(false);
  const [editingRecurring, setEditingRecurring] = useState<RecurringSchedule | null>(null);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [recurringViewMode, setRecurringViewMode] = useState<"list" | "weekly">("list");

  const [scheduleForm, setScheduleForm] = useState({
    workerId: "",
    companyId: "",
    date: "",
    startTime: "",
    endTime: "",
    department: "",
    jobId: "",
    positionId: "",
    costCenterId: "",
    note: "",
  });

  const [editForm, setEditForm] = useState({
    startTime: "",
    endTime: "",
    department: "",
    jobId: "",
    positionId: "",
    costCenterId: "",
    note: "",
    status: "draft" as string,
  });

  const [recurringForm, setRecurringForm] = useState({
    companyId: "",
    workerId: "",
    dayOfWeek: "",
    startTime: "",
    endTime: "",
    effectiveFrom: "",
    effectiveTo: "",
    jobId: "",
    positionId: "",
    costCenterId: "",
    note: "",
  });

  const [editRecurringForm, setEditRecurringForm] = useState({
    companyId: "",
    workerId: "",
    dayOfWeek: "",
    startTime: "",
    endTime: "",
    effectiveFrom: "",
    effectiveTo: "",
    jobId: "",
    positionId: "",
    costCenterId: "",
    note: "",
    isActive: true,
  });

  const [generateForm, setGenerateForm] = useState({
    companyId: "",
    startDate: "",
    endDate: "",
  });

  const [publishOpen, setPublishOpen] = useState(false);
  const [publishForm, setPublishForm] = useState({
    companyId: "",
    startDate: "",
    endDate: "",
  });
  const [publishResult, setPublishResult] = useState<{ published: number; notified: number } | null>(null);

  const getLaborWeekRange = () => {
    const now = new Date();
    const day = now.getDay();
    const start = new Date(now);
    start.setDate(now.getDate() - day);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return {
      start: formatDate(start),
      end: formatDate(end),
    };
  };
  const laborWeekDefault = getLaborWeekRange();
  const [laborCompany, setLaborCompany] = useState<string>("all");
  const [laborStart, setLaborStart] = useState(laborWeekDefault.start);
  const [laborEnd, setLaborEnd] = useState(laborWeekDefault.end);

  const { data: laborSummary = [], isLoading: laborLoading } = useQuery<any[]>({
    queryKey: ["/api/schedule/labor-summary", laborCompany, laborStart, laborEnd],
    queryFn: async () => {
      if (!laborStart || !laborEnd) return [];
      const targetCompany = laborCompany !== "all" ? laborCompany : "";
      if (!targetCompany) return [];
      const res = await fetch(
        `/api/schedule/labor-summary?companyId=${targetCompany}&startDate=${laborStart}&endDate=${laborEnd}`,
        { credentials: "include" }
      );
      return res.json();
    },
    enabled: laborCompany !== "all" && !!laborStart && !!laborEnd,
  });

  const baseDate = new Date();
  if (viewMode === "week") {
    baseDate.setDate(baseDate.getDate() + dateOffset * 7);
  } else if (viewMode === "month") {
    baseDate.setMonth(baseDate.getMonth() + dateOffset);
  } else {
    baseDate.setDate(baseDate.getDate() + dateOffset);
  }

  const viewDates = useMemo(() => {
    if (viewMode === "week") return getWeekDates(baseDate);
    if (viewMode === "month") return getMonthDates(baseDate);
    return getDayDates(baseDate);
  }, [viewMode, dateOffset]);

  const dateRangeLabel = useMemo(() => {
    if (viewMode === "day") {
      const d = viewDates[0];
      return `${DAY_NAMES[d.getDay()]}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
    }
    if (viewMode === "week") {
      return `${formatShortDate(viewDates[0])} - ${formatShortDate(viewDates[6])}`;
    }
    return `${MONTH_NAMES[baseDate.getMonth()]} ${baseDate.getFullYear()}`;
  }, [viewMode, viewDates]);

  const { data: schedules = [], isLoading: schedulesLoading } = useQuery<Schedule[]>({
    queryKey: ["/api/schedules"],
  });

  const { data: workers = [], isLoading: workersLoading } = useQuery<Worker[]>({
    queryKey: ["/api/workers"],
  });

  const { data: companies = [], isLoading: companiesLoading } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
  });

  const { data: recurringSchedules = [], isLoading: recurringLoading } = useQuery<RecurringSchedule[]>({
    queryKey: ["/api/recurring-schedules"],
  });

  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ["/api/departments"],
  });
  const { data: jobs = [] } = useQuery<any[]>({
    queryKey: ["/api/jobs"],
  });
  const { data: positions = [] } = useQuery<any[]>({
    queryKey: ["/api/positions"],
  });
  const { data: costCenters = [] } = useQuery<any[]>({
    queryKey: ["/api/cost-centers"],
  });

  const { data: shiftOffers = [] } = useQuery<ShiftOffer[]>({
    queryKey: ["/api/shift-offers"],
  });

  const { data: timeOffRequests = [] } = useQuery<any[]>({
    queryKey: ["/api/time-off-requests"],
    queryFn: async () => {
      const res = await fetch("/api/time-off-requests", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: currentUser } = useQuery<any>({
    queryKey: ["/api/auth/me"],
  });

  const [offerShiftOpen, setOfferShiftOpen] = useState(false);
  const [offeringSchedule, setOfferingSchedule] = useState<Schedule | null>(null);
  const [offerNote, setOfferNote] = useState("");
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectOfferId, setRejectOfferId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  const createOfferMutation = useMutation({
    mutationFn: async (data: { scheduleId: string; offeredByWorkerId: string; notes: string }) => {
      const res = await apiRequest("POST", "/api/shift-offers", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/shift-offers"] });
      setOfferShiftOpen(false);
      setOfferingSchedule(null);
      setOfferNote("");
      toast({ title: "Shift offered for pickup" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const claimOfferMutation = useMutation({
    mutationFn: async ({ offerId, workerId }: { offerId: string; workerId: string }) => {
      const res = await apiRequest("PATCH", `/api/shift-offers/${offerId}`, { status: "claimed", claimedByWorkerId: workerId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/shift-offers"] });
      toast({ title: "Shift claimed — pending manager approval" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const approveOfferMutation = useMutation({
    mutationFn: async (offerId: string) => {
      const res = await apiRequest("PATCH", `/api/shift-offers/${offerId}`, { status: "approved", approvedBy: currentUser?.id });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/shift-offers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
      toast({ title: "Shift pickup approved" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const withdrawOfferMutation = useMutation({
    mutationFn: async (offerId: string) => {
      const res = await apiRequest("PATCH", `/api/shift-offers/${offerId}`, { status: "withdrawn" });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/shift-offers"] });
      toast({ title: "Shift offer withdrawn" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const rejectOfferMutation = useMutation({
    mutationFn: async ({ offerId, managerNote }: { offerId: string; managerNote: string }) => {
      const res = await apiRequest("PATCH", `/api/shift-offers/${offerId}`, { status: "rejected", managerNote });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/shift-offers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
      setRejectDialogOpen(false);
      setRejectOfferId(null);
      setRejectNote("");
      toast({ title: "Shift exchange rejected", description: "Both employees have been notified." });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const filteredWorkers = useMemo(() => {
    let w = workers.filter(w => w.isActive);
    if (selectedCompany !== "all") {
      w = w.filter(w => w.companyId === selectedCompany);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      w = w.filter(w =>
        `${w.firstName} ${w.lastName}`.toLowerCase().includes(q) ||
        w.employeeNumber?.toLowerCase().includes(q) ||
        w.department?.toLowerCase().includes(q)
      );
    }
    return w.sort((a, b) => a.lastName.localeCompare(b.lastName));
  }, [workers, selectedCompany, searchQuery]);

  const dateStrings = useMemo(() => viewDates.map(formatDate), [viewDates]);

  const scheduledWorkerIds = useMemo(() => {
    const ids = new Set<string>();
    schedules.forEach(s => {
      if (dateStrings.includes(s.date)) {
        if (selectedCompany === "all" || s.companyId === selectedCompany) {
          ids.add(s.workerId);
        }
      }
    });
    return ids;
  }, [schedules, dateStrings, selectedCompany]);

  const displayWorkers = useMemo(() => {
    if (showUnscheduled) return filteredWorkers;
    return filteredWorkers.filter(w => scheduledWorkerIds.has(w.id));
  }, [filteredWorkers, scheduledWorkerIds, showUnscheduled]);

  const addScheduleMutation = useMutation({
    mutationFn: async (data: typeof scheduleForm) => {
      await apiRequest("POST", "/api/schedules", { ...data, jobId: data.jobId || null, positionId: data.positionId || null, costCenterId: data.costCenterId || null });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
      setAddScheduleOpen(false);
      setScheduleForm({ workerId: "", companyId: "", date: "", startTime: "", endTime: "", department: "", jobId: "", positionId: "", costCenterId: "", note: "" });
      toast({ title: "Schedule added" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateScheduleMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof editForm }) => {
      await apiRequest("PATCH", `/api/schedules/${id}`, { ...data, jobId: data.jobId || null, positionId: data.positionId || null, costCenterId: data.costCenterId || null });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
      setEditScheduleOpen(false);
      setEditingSchedule(null);
      toast({ title: "Schedule updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteScheduleMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/schedules/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
      toast({ title: "Schedule deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const addRecurringMutation = useMutation({
    mutationFn: async (data: typeof recurringForm) => {
      await apiRequest("POST", "/api/recurring-schedules", {
        ...data,
        dayOfWeek: parseInt(data.dayOfWeek),
        jobId: data.jobId || null,
        positionId: data.positionId || null,
        costCenterId: data.costCenterId || null,
        note: data.note || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-schedules"] });
      setAddRecurringOpen(false);
      setRecurringForm({ companyId: "", workerId: "", dayOfWeek: "", startTime: "", endTime: "", effectiveFrom: "", effectiveTo: "", jobId: "", positionId: "", costCenterId: "", note: "" });
      toast({ title: "Recurring schedule added" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const generateMutation = useMutation({
    mutationFn: async (data: typeof generateForm) => {
      const res = await apiRequest("POST", "/api/schedules/generate", data);
      const json = await res.json();
      return json;
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
      setGenerateOpen(false);
      if (data.created === 0 && data.templatesFound === 0) {
        toast({
          title: "No templates found",
          description: "No active recurring schedule templates found for this company. Add recurring schedules first.",
          variant: "destructive"
        });
      } else if (data.created === 0 && data.skipped > 0) {
        toast({
          title: "Already up to date",
          description: `All ${data.skipped} shift(s) from ${data.templatesFound} recurring template(s) already exist in this date range. View them in the Schedule Grid.`,
          variant: "default"
        });
      } else {
        const skipNote = data.skipped > 0 ? ` (${data.skipped} already existed and were skipped)` : "";
        toast({ 
          title: "Schedules Generated", 
          description: `Created ${data.created} draft shift(s) from ${data.templatesFound} recurring template(s).${skipNote}`,
          variant: "default"
        });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Error generating schedules", description: error.message, variant: "destructive" });
    },
  });

  const publishMutation = useMutation({
    mutationFn: async (data: typeof publishForm) => {
      const res = await apiRequest("POST", "/api/schedules/publish", data);
      const json = await res.json();
      return json;
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
      setPublishResult({ published: data.published, notified: data.notified });
      if (data.published === 0) {
        toast({ title: "No draft schedules found", description: "All schedules in that range are already published.", variant: "default" });
      } else {
        toast({ 
          title: "Schedule Published!", 
          description: `Published ${data.published} shift(s) and notified ${data.notified} worker(s).`,
          variant: "default"
        });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Error publishing schedule", description: error.message, variant: "destructive" });
    },
  });

  const deleteRecurringMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/recurring-schedules/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-schedules"] });
      toast({ title: "Recurring schedule deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateRecurringMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof editRecurringForm }) => {
      await apiRequest("PATCH", `/api/recurring-schedules/${id}`, {
        ...data,
        dayOfWeek: data.dayOfWeek ? Number(data.dayOfWeek) : undefined,
        jobId: data.jobId || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-schedules"] });
      setEditRecurringOpen(false);
      setEditingRecurring(null);
      toast({ title: "Recurring schedule updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const openEditRecurring = (rs: RecurringSchedule) => {
    setEditingRecurring(rs);
    setEditRecurringForm({
      companyId: rs.companyId || "",
      workerId: rs.workerId || "",
      dayOfWeek: String(rs.dayOfWeek),
      startTime: rs.startTime,
      endTime: rs.endTime,
      effectiveFrom: rs.effectiveFrom || "",
      effectiveTo: rs.effectiveTo || "",
      jobId: (rs as any).jobId || "",
      positionId: (rs as any).positionId || "",
      costCenterId: (rs as any).costCenterId || "",
      note: (rs as any).note || "",
      isActive: rs.isActive ?? true,
    });
    setEditRecurringOpen(true);
  };

  const openEditSchedule = (s: Schedule) => {
    setEditingSchedule(s);
    setEditForm({
      startTime: s.startTime,
      endTime: s.endTime,
      department: s.department || "",
      jobId: (s as any).jobId || "",
      positionId: (s as any).positionId || "",
      costCenterId: (s as any).costCenterId || "",
      note: s.note || "",
      status: s.status || "draft",
    });
    setEditScheduleOpen(true);
  };

  const handleTabChange = (value: string) => {
    if (value === "templates") value = "recurring";
    setLocation(value === "schedules" ? "/app/schedule" : `/app/schedule?tab=${value}`);
  };

  const handlePrint = () => {
    window.print();
  };

  const dailyTotals = useMemo(() => {
    const totals: Record<string, { shifts: number; hours: number; cost: number }> = {};
    dateStrings.forEach(ds => {
      const daySchedules = schedules.filter(s => s.date === ds && (selectedCompany === "all" || s.companyId === selectedCompany));
      const hours = daySchedules.reduce((sum, s) => sum + parseTimeToHours(s.startTime, s.endTime), 0);
      const cost = daySchedules.reduce((sum, s) => {
        const worker = workers.find(w => w.id === s.workerId);
        const rate = Number(worker?.payRate || 0);
        return sum + parseTimeToHours(s.startTime, s.endTime) * rate;
      }, 0);
      totals[ds] = { shifts: daySchedules.length, hours, cost };
    });
    return totals;
  }, [schedules, dateStrings, selectedCompany, workers]);

  const weeklyTotal = useMemo(() => {
    let shifts = 0;
    let hours = 0;
    let cost = 0;
    Object.values(dailyTotals).forEach(t => {
      shifts += t.shifts;
      hours += t.hours;
      cost += t.cost;
    });
    return { shifts, hours: Math.round(hours * 100) / 100, cost: Math.round(cost * 100) / 100 };
  }, [dailyTotals]);

  const isLoading = schedulesLoading || workersLoading || companiesLoading;

  // Count draft shifts in the currently visible date range
  const visibleDraftCount = useMemo(() => {
    const dateSet = new Set(dateStrings);
    return schedules.filter(s =>
      s.status === "draft" &&
      dateSet.has(s.date) &&
      (selectedCompany === "all" || s.companyId === selectedCompany)
    ).length;
  }, [schedules, dateStrings, selectedCompany]);

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-blue-accent" />
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Schedules</h1>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <div className="overflow-x-auto -mx-1 px-1">
        <TabsList className="inline-flex w-max" data-testid="tabs-schedule">
          <TabsTrigger value="schedules" data-testid="tab-schedules">
            <Calendar className="h-4 w-4 mr-1" />
            Schedules
          </TabsTrigger>
          <TabsTrigger value="shifts" data-testid="tab-shifts">
            <Clock className="h-4 w-4 mr-1" />
            Scheduled Shifts
          </TabsTrigger>
          <TabsTrigger value="recurring" data-testid="tab-recurring">
            <RefreshCw className="h-4 w-4 mr-1" />
            Recurring Schedule
          </TabsTrigger>
          <TabsTrigger value="labor" data-testid="tab-labor">
            <TrendingUp className="h-4 w-4 mr-1" />
            Labor Projection
          </TabsTrigger>
          {marketplaceEnabled && (
            <TabsTrigger value="marketplace" data-testid="tab-marketplace">
              <RefreshCw className="h-4 w-4 mr-1" />
              Shift Marketplace
              {shiftOffers.filter(o => o.status === "open" || o.status === "claimed").length > 0 && (
                <Badge className="ml-1 h-4 px-1 text-xs" variant="destructive">
                  {shiftOffers.filter(o => o.status === "open" || o.status === "claimed").length}
                </Badge>
              )}
            </TabsTrigger>
          )}
        </TabsList>
        </div>

        <Dialog open={offerShiftOpen} onOpenChange={setOfferShiftOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Offer Shift for Pickup</DialogTitle></DialogHeader>
            {offeringSchedule && (
              <div className="space-y-3">
                <div className="rounded-lg border p-3 bg-muted/50">
                  <p className="font-medium">{getWorkerName(workers, offeringSchedule.workerId)}</p>
                  <p className="text-sm text-muted-foreground">{offeringSchedule.date} · {formatShiftRange(offeringSchedule.startTime, offeringSchedule.endTime, timeFormat)}</p>
                </div>
                <div className="grid gap-1">
                  <Label>Notes (optional)</Label>
                  <Input value={offerNote} onChange={e => setOfferNote(e.target.value)} placeholder="Reason for offering..." data-testid="input-offer-note" />
                </div>
                <Button
                  className="w-full"
                  disabled={createOfferMutation.isPending}
                  onClick={() => offeringSchedule && createOfferMutation.mutate({ scheduleId: offeringSchedule.id, offeredByWorkerId: offeringSchedule.workerId, notes: offerNote })}
                  data-testid="button-submit-offer"
                >
                  {createOfferMutation.isPending ? "Offering..." : "Offer Shift for Pickup"}
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>

        <TabsContent value="schedules" className="space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1 border rounded-md overflow-visible">
                <Button
                  variant={viewMode === "day" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => { setViewMode("day"); setDateOffset(0); }}
                  data-testid="button-view-day"
                >
                  Day
                </Button>
                <Button
                  variant={viewMode === "week" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => { setViewMode("week"); setDateOffset(0); }}
                  data-testid="button-view-week"
                >
                  Week
                </Button>
                <Button
                  variant={viewMode === "month" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => { setViewMode("month"); setDateOffset(0); }}
                  data-testid="button-view-month"
                >
                  Month
                </Button>
              </div>

              <Button
                size="icon"
                variant="outline"
                onClick={() => setDateOffset((d) => d - 1)}
                data-testid="button-prev-period"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm font-medium min-w-[120px] text-center" data-testid="text-date-range">
                {dateRangeLabel}
              </span>
              <Button
                size="icon"
                variant="outline"
                onClick={() => setDateOffset((d) => d + 1)}
                data-testid="button-next-period"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDateOffset(0)}
                data-testid="button-today"
              >
                Today
              </Button>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search employees..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 w-[180px]"
                  data-testid="input-search-schedule"
                />
                {searchQuery && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="absolute right-0 top-0"
                    onClick={() => setSearchQuery("")}
                    data-testid="button-clear-search"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>

              <Select value={selectedCompany} onValueChange={setSelectedCompany}>
                <SelectTrigger className="w-[180px]" data-testid="select-company-filter">
                  <SelectValue placeholder="All Companies" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Companies</SelectItem>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" variant="outline" data-testid="button-schedule-settings">
                    <Settings className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Schedule Settings</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem
                    checked={showDailyTotals}
                    onCheckedChange={setShowDailyTotals}
                    data-testid="checkbox-daily-totals"
                  >
                    Daily Totals
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={showWeeklyTotals}
                    onCheckedChange={setShowWeeklyTotals}
                    data-testid="checkbox-weekly-totals"
                  >
                    Weekly Totals
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={showUnscheduled}
                    onCheckedChange={setShowUnscheduled}
                    data-testid="checkbox-show-unscheduled"
                  >
                    Show Unscheduled Employees
                  </DropdownMenuCheckboxItem>
                  {isAdminOrManager && (
                    <DropdownMenuCheckboxItem
                      checked={showNotes}
                      onCheckedChange={setShowNotes}
                      data-testid="checkbox-show-notes"
                    >
                      Show All Shift Notes
                    </DropdownMenuCheckboxItem>
                  )}
                  {isAdminOrManager && (
                    <DropdownMenuCheckboxItem
                      checked={showLaborCosts}
                      onCheckedChange={setShowLaborCosts}
                      data-testid="checkbox-show-labor-costs"
                    >
                      Show Projected Labor Costs
                    </DropdownMenuCheckboxItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>

              <Button variant="outline" size="icon" onClick={handlePrint} data-testid="button-print-schedule">
                <Printer className="h-4 w-4" />
              </Button>

              {isAdminOrManager && (
                <Dialog open={publishOpen} onOpenChange={(o) => { setPublishOpen(o); if (!o) { setPublishResult(null); } }}>
                  <DialogTrigger asChild>
                    <Button
                      variant="outline"
                      className="relative border-emerald-500 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-400 dark:text-emerald-400 dark:hover:bg-emerald-950"
                      data-testid="button-publish-schedule"
                      onClick={() => {
                        // Pre-populate with current view's date range
                        const first = dateStrings[0] || "";
                        const last = dateStrings[dateStrings.length - 1] || "";
                        setPublishForm(f => ({
                          ...f,
                          companyId: selectedCompany === "all" ? (companies[0]?.id || "") : selectedCompany,
                          startDate: first,
                          endDate: last,
                        }));
                        setPublishResult(null);
                      }}
                    >
                      <Send className="h-4 w-4 mr-1" />
                      Publish Schedule
                      {visibleDraftCount > 0 && (
                        <Badge className="ml-1.5 h-4 px-1 text-[10px] bg-amber-500 hover:bg-amber-500 text-white border-0">
                          {visibleDraftCount}
                        </Badge>
                      )}
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2">
                        <Send className="h-5 w-5 text-emerald-600" />
                        Publish Schedule
                      </DialogTitle>
                    </DialogHeader>
                    {publishResult ? (
                      <div className="space-y-4">
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800 p-4 text-center space-y-2">
                          <CheckCircle2 className="h-10 w-10 text-emerald-600 mx-auto" />
                          <div className="font-semibold text-emerald-800 dark:text-emerald-200">Schedule Published!</div>
                          <div className="text-sm text-emerald-700 dark:text-emerald-300">
                            {publishResult.published} shift{publishResult.published !== 1 ? "s" : ""} published
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {publishResult.notified > 0
                              ? `${publishResult.notified} worker${publishResult.notified !== 1 ? "s" : ""} notified via email and SMS`
                              : "Workers were not notified (email/SMS not configured)"}
                          </div>
                        </div>
                        {publishResult.notified === 0 && (
                          <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-3 flex gap-2">
                            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                            <div className="text-xs text-amber-800 dark:text-amber-200">
                              To enable email & SMS notifications, configure SMTP and Twilio credentials in your environment settings.
                            </div>
                          </div>
                        )}
                        <DialogClose asChild>
                          <Button className="w-full" variant="outline">Close</Button>
                        </DialogClose>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                          Publishing will mark all <strong>draft</strong> shifts in the selected date range as published and send email + SMS notifications to each employee and contractor on the schedule.
                        </p>
                        <div>
                          <Label>Company</Label>
                          <Select
                            value={publishForm.companyId}
                            onValueChange={(v) => setPublishForm(f => ({ ...f, companyId: v }))}
                          >
                            <SelectTrigger data-testid="select-publish-company">
                              <SelectValue placeholder="Select company" />
                            </SelectTrigger>
                            <SelectContent>
                              {companies.map(c => (
                                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div>
                            <Label>From Date</Label>
                            <Input
                              type="date"
                              value={publishForm.startDate}
                              onChange={(e) => setPublishForm(f => ({ ...f, startDate: e.target.value }))}
                              data-testid="input-publish-start-date"
                            />
                          </div>
                          <div>
                            <Label>To Date</Label>
                            <Input
                              type="date"
                              value={publishForm.endDate}
                              onChange={(e) => setPublishForm(f => ({ ...f, endDate: e.target.value }))}
                              data-testid="input-publish-end-date"
                            />
                          </div>
                        </div>
                        {(() => {
                          if (!publishForm.companyId || !publishForm.startDate || !publishForm.endDate) return null;
                          const rangeStart = publishForm.startDate;
                          const rangeEnd = publishForm.endDate;
                          const drafts = schedules.filter(s =>
                            s.status === "draft" &&
                            s.companyId === publishForm.companyId &&
                            s.date >= rangeStart &&
                            s.date <= rangeEnd
                          );
                          const uniqueWorkers = new Set(drafts.map(s => s.workerId)).size;
                          if (drafts.length === 0) {
                            return (
                              <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 p-3 flex gap-2 items-start">
                                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                                <div className="text-xs text-amber-800 dark:text-amber-200">No draft shifts found in this range. All shifts may already be published.</div>
                              </div>
                            );
                          }
                          return (
                            <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 p-3 text-xs text-emerald-800 dark:text-emerald-200">
                              <strong>{drafts.length}</strong> draft shift{drafts.length !== 1 ? "s" : ""} for <strong>{uniqueWorkers}</strong> worker{uniqueWorkers !== 1 ? "s" : ""} will be published and notified.
                            </div>
                          );
                        })()}
                        <DialogFooter>
                          <DialogClose asChild>
                            <Button variant="outline">Cancel</Button>
                          </DialogClose>
                          <Button
                            onClick={() => publishMutation.mutate(publishForm)}
                            disabled={publishMutation.isPending || !publishForm.companyId || !publishForm.startDate || !publishForm.endDate}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white"
                            data-testid="button-confirm-publish"
                          >
                            {publishMutation.isPending ? (
                              <>Publishing...</>
                            ) : (
                              <><Send className="h-4 w-4 mr-1" />Publish & Notify</>
                            )}
                          </Button>
                        </DialogFooter>
                      </div>
                    )}
                  </DialogContent>
                </Dialog>
              )}

              {isAdminOrManager && (
                <Button onClick={() => setAddScheduleOpen(true)} data-testid="button-add-schedule">
                  <Plus className="h-4 w-4 mr-1" />
                  Add Shift
                </Button>
              )}
            </div>
          </div>

          {isLoading ? (
            <div className="space-y-2" data-testid="skeleton-schedule-grid">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <Table data-testid="table-schedule-grid">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[160px] sticky left-0 bg-card z-10 border-r" data-testid="header-employee">
                        Employee
                      </TableHead>
                      {viewDates.map((d) => {
                        const ds = formatDate(d);
                        const isToday = formatDate(new Date()) === ds;
                        return (
                          <TableHead
                            key={ds}
                            className={`min-w-[120px] text-center ${isToday ? "bg-primary/10 font-bold" : ""}`}
                            data-testid={`header-day-${ds}`}
                          >
                            <div className="text-xs">{DAY_NAMES[d.getDay()]}</div>
                            <div>{formatShortDate(d)}</div>
                          </TableHead>
                        );
                      })}
                      {showWeeklyTotals && viewMode === "week" && (
                        <TableHead className="min-w-[80px] text-center font-bold" data-testid="header-weekly-total">
                          Total
                        </TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayWorkers.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={viewDates.length + 1 + (showWeeklyTotals && viewMode === "week" ? 1 : 0)} className="text-center text-muted-foreground py-8">
                          {showUnscheduled ? "No employees found." : "No scheduled employees. Enable 'Show Unscheduled Employees' in settings to see all employees."}
                        </TableCell>
                      </TableRow>
                    ) : (
                      displayWorkers.map((worker) => {
                        let workerWeekHours = 0;
                        let workerWeekShifts = 0;
                        let workerWeekCost = 0;
                        const workerPayRate = Number(worker.payRate || 0);
                        return (
                          <TableRow key={worker.id} data-testid={`row-worker-${worker.id}`}>
                            <TableCell className="sticky left-0 bg-card z-10 border-r font-medium" data-testid={`text-worker-name-${worker.id}`}>
                              <div className="text-sm">{worker.lastName}, {worker.firstName}</div>
                              {worker.jobTitle && <div className="text-xs text-muted-foreground">{worker.jobTitle}</div>}
                            </TableCell>
                            {viewDates.map((d) => {
                              const ds = formatDate(d);
                              const isToday = formatDate(new Date()) === ds;
                              const cellSchedules = schedules.filter(
                                (s) => s.date === ds && s.workerId === worker.id && (selectedCompany === "all" || s.companyId === selectedCompany)
                              );
                              cellSchedules.forEach(s => {
                                const h = parseTimeToHours(s.startTime, s.endTime);
                                workerWeekHours += h;
                                workerWeekCost += h * workerPayRate;
                                workerWeekShifts++;
                              });
                              return (
                                <TableCell
                                  key={ds}
                                  className={`text-center p-1 ${isToday ? "bg-primary/5" : ""}`}
                                  data-testid={`cell-${worker.id}-${ds}`}
                                >
                                  {(() => {
                                    const approvedTimeOff = timeOffRequests.filter((tor: any) =>
                                      tor.workerId === worker.id &&
                                      tor.status === "approved" &&
                                      ds >= tor.startDate && ds <= tor.endDate
                                    );
                                    if (approvedTimeOff.length > 0) {
                                      return (
                                        <div className="rounded px-1 py-0.5 text-xs bg-orange-100 dark:bg-orange-900/30 border border-orange-300 dark:border-orange-700" data-testid={`timeoff-${worker.id}-${ds}`}>
                                          <div className="font-medium text-orange-700 dark:text-orange-300">TIME OFF</div>
                                          <div className="text-[10px] text-orange-600 dark:text-orange-400">{approvedTimeOff[0].requestType || "PTO"}</div>
                                        </div>
                                      );
                                    }
                                    return null;
                                  })()}
                                  {cellSchedules.length === 0 && !timeOffRequests.some((tor: any) =>
                                    tor.workerId === worker.id && tor.status === "approved" && ds >= tor.startDate && ds <= tor.endDate
                                  ) ? (
                                    <span className="text-xs text-muted-foreground">-</span>
                                  ) : cellSchedules.length > 0 ? (
                                    <div className="space-y-1">
                                      {cellSchedules.map((s: any) => (
                                        <div
                                          key={s.id}
                                          className={`group relative rounded px-1 py-0.5 text-xs cursor-pointer hover-elevate ${
                                            shiftOffers.some(o => o.scheduleId === s.id && (o.status === "open" || o.status === "claimed"))
                                              ? "bg-amber-100 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700"
                                              : s.status === "draft"
                                                ? "bg-primary/10 border border-dashed border-amber-400 dark:border-amber-600"
                                                : "bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800"
                                          }`}
                                          data-testid={`shift-${s.id}`}
                                          onClick={() => isAdminOrManager && openEditSchedule(s)}
                                          title={isAdminOrManager ? (s.status === "draft" ? "Draft — click to edit" : "Published — click to edit") : undefined}
                                          style={{ cursor: isAdminOrManager ? "pointer" : "default" }}
                                        >
                                          <div className="font-medium pr-5 flex items-center gap-1">
                                            {formatShiftRange(s.startTime, s.endTime, timeFormat)}
                                            {s.status === "draft" && (
                                              <span className="text-[9px] font-bold text-amber-600 dark:text-amber-400 uppercase leading-none">draft</span>
                                            )}
                                          </div>
                                          {selectedCompany === "all" && (() => {
                                            const co = companies.find(c => c.id === s.companyId);
                                            return co ? <div className="text-[10px] text-indigo-600 dark:text-indigo-400 font-medium leading-tight truncate">{co.name}</div> : null;
                                          })()}
                                          <div className="text-muted-foreground">{parseTimeToHours(s.startTime, s.endTime)}h
                                            {showLaborCosts && isAdminOrManager && (() => {
                                              const worker = workers.find(w => w.id === s.workerId);
                                              const rate = Number(worker?.payRate || 0);
                                              const cost = parseTimeToHours(s.startTime, s.endTime) * rate;
                                              return rate > 0 ? <span className="ml-1 text-emerald-600 dark:text-emerald-400">${cost.toFixed(2)}</span> : null;
                                            })()}
                                          </div>
                                          {(s as any).positionId && (() => {
                                            const pos = positions.find((p: any) => p.id === (s as any).positionId);
                                            return pos ? <div className="text-[10px] text-purple-600 dark:text-purple-400 font-medium leading-tight truncate">{pos.title}</div> : null;
                                          })()}
                                          {(s as any).jobId && (() => {
                                            const job = jobs.find(j => j.id === (s as any).jobId);
                                            return job ? <div className="text-[10px] text-blue-600 dark:text-blue-400 font-medium leading-tight truncate">{job.name}</div> : null;
                                          })()}
                                          {((s.workerId === user?.workerId) || (isAdminOrManager && showNotes)) && s.note && (
                                            <div className="text-muted-foreground text-[10px] italic leading-tight mt-0.5 break-words">{s.note}</div>
                                          )}
                                          {shiftOffers.some(o => o.scheduleId === s.id && o.status === "open") && (
                                            <div className="text-amber-600 dark:text-amber-400 font-semibold text-[10px]">⚑ Open for pickup</div>
                                          )}
                                          {shiftOffers.some(o => o.scheduleId === s.id && o.status === "claimed") && (
                                            <div className="text-blue-600 dark:text-blue-400 font-semibold text-[10px]">⚑ Claimed — needs approval</div>
                                          )}
                                          {/* Always-visible edit icon in top-right corner — managers/admins only */}
                                          {isAdminOrManager && (
                                            <Pencil className="absolute top-0.5 right-0.5 h-2.5 w-2.5 text-muted-foreground/50 group-hover:text-primary transition-colors" />
                                          )}
                                          {/* Hover-only offer & delete buttons */}
                                          <div className="invisible group-hover:visible absolute top-0 right-4 flex gap-0.5 z-20">
                                            <Button
                                              size="icon"
                                              variant="ghost"
                                              title="Offer shift for pickup"
                                              onClick={(e) => { e.stopPropagation(); setOfferingSchedule(s); setOfferShiftOpen(true); }}
                                              data-testid={`button-offer-shift-${s.id}`}
                                            >
                                              <RefreshCw className="h-3 w-3 text-amber-600" />
                                            </Button>
                                            {isAdminOrManager && (
                                              <Button
                                                size="icon"
                                                variant="ghost"
                                                onClick={(e) => { e.stopPropagation(); deleteScheduleMutation.mutate(s.id); }}
                                                data-testid={`button-delete-shift-${s.id}`}
                                              >
                                                <Trash2 className="h-3 w-3" />
                                              </Button>
                                            )}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  ) : null}
                                </TableCell>
                              );
                            })}
                            {showWeeklyTotals && viewMode === "week" && (
                              <TableCell className="text-center font-medium" data-testid={`total-worker-${worker.id}`}>
                                <div className="text-xs">{workerWeekShifts} shifts</div>
                                <div className="text-sm font-bold">{Math.round(workerWeekHours * 100) / 100}h</div>
                                {showLaborCosts && isAdminOrManager && workerPayRate > 0 && (
                                  <div className="text-xs text-emerald-600 dark:text-emerald-400">${Math.round(workerWeekCost * 100) / 100}</div>
                                )}
                              </TableCell>
                            )}
                          </TableRow>
                        );
                      })
                    )}
                    {showDailyTotals && displayWorkers.length > 0 && (
                      <TableRow className="border-t-2 font-bold" data-testid="row-daily-totals">
                        <TableCell className="sticky left-0 bg-card z-10 border-r text-sm">Daily Totals</TableCell>
                        {viewDates.map((d) => {
                          const ds = formatDate(d);
                          const t = dailyTotals[ds] || { shifts: 0, hours: 0, cost: 0 };
                          return (
                            <TableCell key={ds} className="text-center" data-testid={`daily-total-${ds}`}>
                              <div className="text-xs">{t.shifts} shifts</div>
                              <div className="text-sm">{t.hours}h</div>
                              {showLaborCosts && isAdminOrManager && (
                                <div className="text-xs text-emerald-600 dark:text-emerald-400">${t.cost.toFixed(2)}</div>
                              )}
                            </TableCell>
                          );
                        })}
                        {showWeeklyTotals && viewMode === "week" && (
                          <TableCell className="text-center" data-testid="grand-total">
                            <div className="text-xs">{weeklyTotal.shifts} shifts</div>
                            <div className="text-sm">{weeklyTotal.hours}h</div>
                            {showLaborCosts && isAdminOrManager && (
                              <div className="text-xs text-emerald-600 dark:text-emerald-400">${weeklyTotal.cost.toFixed(2)}</div>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="shifts">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Scheduled Shifts
              </CardTitle>
              <div className="flex items-center gap-2 flex-wrap">
                <Select value={selectedCompany} onValueChange={setSelectedCompany}>
                  <SelectTrigger className="w-[180px]" data-testid="select-shifts-company">
                    <SelectValue placeholder="All Companies" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Companies</SelectItem>
                    {companies.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {isAdminOrManager && (
                  <Button onClick={() => setAddScheduleOpen(true)} data-testid="button-add-shift-list">
                    <Plus className="h-4 w-4 mr-1" />
                    Add Shift
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-2" data-testid="skeleton-shifts-table">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : (
                <Table data-testid="table-shifts">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Start Time</TableHead>
                      <TableHead>End Time</TableHead>
                      <TableHead>Hours</TableHead>
                      <TableHead>Department</TableHead>
                      <TableHead>Position</TableHead>
                      <TableHead>Cost Center</TableHead>
                      <TableHead>Status</TableHead>
                      {isAdminOrManager && <TableHead>Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {schedules.filter(s => selectedCompany === "all" || s.companyId === selectedCompany).length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={11} className="text-center text-muted-foreground">
                          No scheduled shifts found.
                        </TableCell>
                      </TableRow>
                    ) : (
                      schedules
                        .filter(s => selectedCompany === "all" || s.companyId === selectedCompany)
                        .map((s) => (
                          <TableRow key={s.id} data-testid={`row-shift-${s.id}`}>
                            <TableCell data-testid={`text-employee-${s.id}`}>
                              {getWorkerName(workers, s.workerId)}
                            </TableCell>
                            <TableCell data-testid={`text-company-${s.id}`}>
                              {companies.find(c => c.id === s.companyId)?.name || "-"}
                            </TableCell>
                            <TableCell>{s.date}</TableCell>
                            <TableCell>{s.startTime}</TableCell>
                            <TableCell>{s.endTime}</TableCell>
                            <TableCell>{parseTimeToHours(s.startTime, s.endTime)}h</TableCell>
                            <TableCell>{s.department || "-"}</TableCell>
                            <TableCell data-testid={`text-position-${s.id}`}>
                              {(s as any).positionId ? (positions.find((p: any) => p.id === (s as any).positionId)?.title || "-") : "-"}
                            </TableCell>
                            <TableCell data-testid={`text-cost-center-${s.id}`}>
                              {(s as any).costCenterId ? (costCenters.find((cc: any) => cc.id === (s as any).costCenterId)?.name || "-") : "-"}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={s.status === "published" ? "default" : "secondary"}
                                data-testid={`badge-shift-status-${s.id}`}
                              >
                                {s.status}
                              </Badge>
                            </TableCell>
                            {isAdminOrManager && (
                              <TableCell>
                                <div className="flex items-center gap-1">
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={() => openEditSchedule(s)}
                                    data-testid={`button-edit-${s.id}`}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={() => deleteScheduleMutation.mutate(s.id)}
                                    data-testid={`button-delete-${s.id}`}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </TableCell>
                            )}
                          </TableRow>
                        ))
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="recurring" className="space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <RefreshCw className="h-5 w-5" />
              Recurring Schedules
            </h2>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1 border rounded-md overflow-hidden">
                <Button
                  variant={recurringViewMode === "list" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setRecurringViewMode("list")}
                  data-testid="button-recurring-list-view"
                >
                  List
                </Button>
                <Button
                  variant={recurringViewMode === "weekly" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setRecurringViewMode("weekly")}
                  data-testid="button-recurring-weekly-view"
                >
                  Weekly View
                </Button>
              </div>
              <Dialog open={generateOpen} onOpenChange={setGenerateOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" data-testid="button-generate-schedules">
                    <Download className="h-4 w-4 mr-1" />
                    Generate Schedules
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Generate Schedules from Templates</DialogTitle>
                  </DialogHeader>
                  <p className="text-sm text-muted-foreground">
                    Create schedule entries from active recurring templates for a date range.
                  </p>
                  <div className="space-y-3">
                    <div>
                      <Label>Company</Label>
                      <Select
                        value={generateForm.companyId}
                        onValueChange={(v) => setGenerateForm((f) => ({ ...f, companyId: v }))}
                      >
                        <SelectTrigger data-testid="select-generate-company">
                          <SelectValue placeholder="Select company" />
                        </SelectTrigger>
                        <SelectContent>
                          {companies.map((c) => (
                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <Label>Start Date</Label>
                        <Input
                          type="date"
                          value={generateForm.startDate}
                          onChange={(e) => setGenerateForm((f) => ({ ...f, startDate: e.target.value }))}
                          data-testid="input-generate-start"
                        />
                      </div>
                      <div>
                        <Label>End Date</Label>
                        <Input
                          type="date"
                          value={generateForm.endDate}
                          onChange={(e) => setGenerateForm((f) => ({ ...f, endDate: e.target.value }))}
                          data-testid="input-generate-end"
                        />
                      </div>
                    </div>
                    
                    {generateForm.companyId && (
                      <div className="bg-accent/50 border border-primary/20 rounded p-3 space-y-2">
                        <p className="text-sm font-semibold">Recurring Templates to be Used:</p>
                        {(() => {
                          const matching = recurringSchedules.filter(r => {
                            if (!r.isActive) return false;
                            if (r.companyId === generateForm.companyId) return true;
                            const worker = workers.find(w => w.id === r.workerId);
                            return worker?.companyId === generateForm.companyId;
                          });
                          if (matching.length === 0) {
                            return <p className="text-sm text-muted-foreground">⚠ No active recurring schedules found for this company.</p>;
                          }
                          const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
                          return (
                            <div className="space-y-1">
                              {matching.map((r, i) => {
                                const worker = workers.find(w => w.id === r.workerId);
                                const companyMismatch = r.companyId !== generateForm.companyId;
                                return (
                                  <div key={i} className="text-sm text-foreground flex items-center gap-1">
                                    • {worker?.firstName} {worker?.lastName} — {dayNames[r.dayOfWeek]} {formatShiftRange(r.startTime, r.endTime, timeFormat)}
                                    {companyMismatch && (
                                      <span className="text-xs text-amber-600 dark:text-amber-400">(matched via worker)</span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })()}
                      </div>
                    )}
                    
                    <Button
                      className="w-full"
                      onClick={() => generateMutation.mutate(generateForm)}
                      disabled={generateMutation.isPending || !generateForm.companyId || !generateForm.startDate || !generateForm.endDate}
                      data-testid="button-submit-generate"
                    >
                      {generateMutation.isPending ? "Generating..." : "Generate Schedules"}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>

              <Dialog open={addRecurringOpen} onOpenChange={setAddRecurringOpen}>
                <DialogTrigger asChild>
                  <Button data-testid="button-add-recurring">
                    <Plus className="h-4 w-4 mr-1" />
                    Add Recurring Schedule
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add Recurring Schedule</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3">
                    <div>
                      <Label>Company</Label>
                      <Select
                        value={recurringForm.companyId}
                        onValueChange={(v) => setRecurringForm((f) => ({ ...f, companyId: v }))}
                      >
                        <SelectTrigger data-testid="select-recurring-company">
                          <SelectValue placeholder="Select company" />
                        </SelectTrigger>
                        <SelectContent>
                          {companies.map((c) => (
                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Employee</Label>
                      <Select
                        value={recurringForm.workerId}
                        onValueChange={(v) => setRecurringForm((f) => ({ ...f, workerId: v }))}
                      >
                        <SelectTrigger data-testid="select-recurring-worker">
                          <SelectValue placeholder="Select employee or contractor" />
                        </SelectTrigger>
                        <SelectContent>
                          {workers.sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`)).map((w) => (
                            <SelectItem key={w.id} value={w.id}>
                              {w.lastName}, {w.firstName} {w.workerType === "contractor" ? "(Contractor)" : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Day of Week</Label>
                      <Select
                        value={recurringForm.dayOfWeek}
                        onValueChange={(v) => setRecurringForm((f) => ({ ...f, dayOfWeek: v }))}
                      >
                        <SelectTrigger data-testid="select-recurring-day">
                          <SelectValue placeholder="Select day" />
                        </SelectTrigger>
                        <SelectContent>
                          {DAY_NAMES.map((name, i) => (
                            <SelectItem key={i} value={String(i)}>{name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <Label>Start Time</Label>
                        <Input
                          type="time"
                          value={recurringForm.startTime}
                          onChange={(e) => setRecurringForm((f) => ({ ...f, startTime: e.target.value }))}
                          data-testid="input-recurring-start-time"
                        />
                      </div>
                      <div>
                        <Label>End Time</Label>
                        <Input
                          type="time"
                          value={recurringForm.endTime}
                          onChange={(e) => setRecurringForm((f) => ({ ...f, endTime: e.target.value }))}
                          data-testid="input-recurring-end-time"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <Label>Effective From</Label>
                        <Input
                          type="date"
                          value={recurringForm.effectiveFrom}
                          onChange={(e) => setRecurringForm((f) => ({ ...f, effectiveFrom: e.target.value }))}
                          data-testid="input-recurring-effective-from"
                        />
                      </div>
                      <div>
                        <Label>Effective To</Label>
                        <Input
                          type="date"
                          value={recurringForm.effectiveTo}
                          onChange={(e) => setRecurringForm((f) => ({ ...f, effectiveTo: e.target.value }))}
                          data-testid="input-recurring-effective-to"
                        />
                      </div>
                    </div>
                    <div>
                      <Label>Position</Label>
                      <Select
                        value={recurringForm.positionId || "__none__"}
                        onValueChange={(v) => setRecurringForm((f) => ({ ...f, positionId: v === "__none__" ? "" : v }))}
                      >
                        <SelectTrigger data-testid="select-recurring-position">
                          <SelectValue placeholder="Select position (optional)" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">None</SelectItem>
                          {positions
                            .filter((p: any) => !p.companyId || p.companyId === recurringForm.companyId)
                            .filter((p: any) => p.isActive !== false)
                            .map((p: any) => (
                              <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Cost Center</Label>
                      <Select
                        value={recurringForm.costCenterId || "__none__"}
                        onValueChange={(v) => setRecurringForm((f) => ({ ...f, costCenterId: v === "__none__" ? "" : v }))}
                      >
                        <SelectTrigger data-testid="select-recurring-cost-center">
                          <SelectValue placeholder="Select cost center (optional)" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">None</SelectItem>
                          {costCenters
                            .filter((cc: any) => !cc.companyId || cc.companyId === recurringForm.companyId)
                            .filter((cc: any) => cc.isActive !== false)
                            .map((cc: any) => (
                              <SelectItem key={cc.id} value={cc.id}>{cc.name}{cc.code ? ` (${cc.code})` : ""}</SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Note</Label>
                      <Input
                        value={recurringForm.note}
                        onChange={(e) => setRecurringForm((f) => ({ ...f, note: e.target.value }))}
                        placeholder="Optional note"
                        data-testid="input-recurring-note"
                      />
                    </div>
                    <Button
                      className="w-full"
                      onClick={() => addRecurringMutation.mutate(recurringForm)}
                      disabled={addRecurringMutation.isPending || !recurringForm.companyId || !recurringForm.workerId || !recurringForm.dayOfWeek || !recurringForm.startTime || !recurringForm.endTime}
                      data-testid="button-submit-recurring"
                    >
                      {addRecurringMutation.isPending ? "Adding..." : "Add Recurring Schedule"}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          {recurringViewMode === "list" ? (
          <Card>
            <CardContent className="pt-4 overflow-x-auto">
              {recurringLoading || workersLoading ? (
                <div className="space-y-2" data-testid="skeleton-recurring-table">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : (
                <div className="overflow-x-auto"><Table data-testid="table-recurring">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Day of Week</TableHead>
                      <TableHead>Start Time</TableHead>
                      <TableHead>End Time</TableHead>
                      <TableHead>Hours</TableHead>
                      <TableHead>Position</TableHead>
                      <TableHead>Cost Center</TableHead>
                      <TableHead>Effective From</TableHead>
                      <TableHead>Effective To</TableHead>
                      <TableHead>Active</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recurringSchedules.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={11} className="text-center text-muted-foreground">
                          No recurring schedules found.
                        </TableCell>
                      </TableRow>
                    ) : (
                      recurringSchedules.map((rs) => (
                        <TableRow key={rs.id} data-testid={`row-recurring-${rs.id}`}>
                          <TableCell data-testid={`text-recurring-employee-${rs.id}`}>
                            {getWorkerName(workers, rs.workerId)}
                          </TableCell>
                          <TableCell>{DAY_NAMES[rs.dayOfWeek] || rs.dayOfWeek}</TableCell>
                          <TableCell>{formatShiftTime(rs.startTime, timeFormat)}</TableCell>
                          <TableCell>{formatShiftTime(rs.endTime, timeFormat)}</TableCell>
                          <TableCell>{parseTimeToHours(rs.startTime, rs.endTime)}h</TableCell>
                          <TableCell data-testid={`text-recurring-position-${rs.id}`}>
                            {(rs as any).positionId ? (positions.find((p: any) => p.id === (rs as any).positionId)?.title || "-") : "-"}
                          </TableCell>
                          <TableCell data-testid={`text-recurring-cost-center-${rs.id}`}>
                            {(rs as any).costCenterId ? (costCenters.find((cc: any) => cc.id === (rs as any).costCenterId)?.name || "-") : "-"}
                          </TableCell>
                          <TableCell>{rs.effectiveFrom || "-"}</TableCell>
                          <TableCell>{rs.effectiveTo || "-"}</TableCell>
                          <TableCell>
                            <Badge
                              variant={rs.isActive ? "default" : "secondary"}
                              data-testid={`badge-recurring-active-${rs.id}`}
                            >
                              {rs.isActive ? "Active" : "Inactive"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => openEditRecurring(rs)}
                                data-testid={`button-edit-recurring-${rs.id}`}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => deleteRecurringMutation.mutate(rs.id)}
                                data-testid={`button-delete-recurring-${rs.id}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table></div>
              )}
            </CardContent>
          </Card>
          ) : (
          <Card>
            <CardContent className="pt-4">
              {recurringLoading || workersLoading ? (
                <Skeleton className="h-40 w-full" />
              ) : recurringSchedules.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <RefreshCw className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No recurring templates defined yet. Switch to List view to add some.</p>
                </div>
              ) : (
                <div className="grid grid-cols-7 gap-2">
                  {DAY_NAMES.map((day, dayIndex) => {
                    const dayTemplates = recurringSchedules.filter(rs => rs.dayOfWeek === dayIndex && rs.isActive);
                    return (
                      <Card key={dayIndex} className={dayTemplates.length > 0 ? "border-primary/30" : ""}>
                        <CardHeader className="p-2 pb-1">
                          <CardTitle className="text-xs font-medium text-center">{day}</CardTitle>
                        </CardHeader>
                        <CardContent className="p-2 pt-0 space-y-1">
                          {dayTemplates.length === 0 ? (
                            <p className="text-xs text-muted-foreground text-center">—</p>
                          ) : (
                            dayTemplates.map(rs => (
                              <div key={rs.id} className="rounded bg-primary/10 p-1.5 text-xs group relative">
                                <div className="font-medium truncate pr-10">{getWorkerName(workers, rs.workerId)}</div>
                                <div className="text-muted-foreground">{formatShiftRange(rs.startTime, rs.endTime, timeFormat)}</div>
                                {(rs as any).positionId && (() => {
                                  const pos = positions.find((p: any) => p.id === (rs as any).positionId);
                                  return pos ? <div className="text-[10px] text-purple-600 dark:text-purple-400 font-medium leading-tight truncate">{pos.title}</div> : null;
                                })()}
                                <div className="absolute top-0.5 right-0.5 hidden group-hover:flex items-center gap-0.5">
                                  <button
                                    className="p-0.5 rounded hover:bg-primary/20 text-foreground/60 hover:text-foreground"
                                    onClick={() => openEditRecurring(rs)}
                                    title="Edit"
                                    data-testid={`button-weekly-edit-recurring-${rs.id}`}
                                  >
                                    <Pencil className="h-2.5 w-2.5" />
                                  </button>
                                  <button
                                    className="p-0.5 rounded hover:bg-destructive/20 text-foreground/60 hover:text-destructive"
                                    onClick={() => deleteRecurringMutation.mutate(rs.id)}
                                    title="Delete"
                                    data-testid={`button-weekly-delete-recurring-${rs.id}`}
                                  >
                                    <Trash2 className="h-2.5 w-2.5" />
                                  </button>
                                </div>
                              </div>
                            ))
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
          )}

          <Dialog open={editRecurringOpen} onOpenChange={v => { setEditRecurringOpen(v); if (!v) { setEditingRecurring(null); } }}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Edit Recurring Schedule</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Company</label>
                  <Select value={editRecurringForm.companyId} onValueChange={v => setEditRecurringForm(f => ({ ...f, companyId: v }))}>
                    <SelectTrigger data-testid="select-edit-recurring-company"><SelectValue placeholder="Select company" /></SelectTrigger>
                    <SelectContent>
                      {companies.map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Employee</label>
                  <Select value={editRecurringForm.workerId} onValueChange={v => setEditRecurringForm(f => ({ ...f, workerId: v }))}>
                    <SelectTrigger data-testid="select-edit-recurring-worker"><SelectValue placeholder="Select employee or contractor" /></SelectTrigger>
                    <SelectContent>
                      {workers.sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`)).map(w => (
                        <SelectItem key={w.id} value={w.id}>{w.lastName}, {w.firstName} {w.workerType === "contractor" ? "(Contractor)" : ""}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Day of Week</label>
                  <Select value={editRecurringForm.dayOfWeek} onValueChange={v => setEditRecurringForm(f => ({ ...f, dayOfWeek: v }))}>
                    <SelectTrigger data-testid="select-edit-recurring-day"><SelectValue placeholder="Select day" /></SelectTrigger>
                    <SelectContent>
                      {DAY_NAMES.map((d, i) => (
                        <SelectItem key={i} value={String(i)}>{d}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Start Time</label>
                    <input type="time" className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                      value={editRecurringForm.startTime}
                      onChange={e => setEditRecurringForm(f => ({ ...f, startTime: e.target.value }))}
                      data-testid="input-edit-recurring-start-time" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">End Time</label>
                    <input type="time" className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                      value={editRecurringForm.endTime}
                      onChange={e => setEditRecurringForm(f => ({ ...f, endTime: e.target.value }))}
                      data-testid="input-edit-recurring-end-time" />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Effective From</label>
                    <input type="date" className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                      value={editRecurringForm.effectiveFrom}
                      onChange={e => setEditRecurringForm(f => ({ ...f, effectiveFrom: e.target.value }))}
                      data-testid="input-edit-recurring-effective-from" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Effective To</label>
                    <input type="date" className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                      value={editRecurringForm.effectiveTo}
                      onChange={e => setEditRecurringForm(f => ({ ...f, effectiveTo: e.target.value }))}
                      data-testid="input-edit-recurring-effective-to" />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Position</label>
                  <Select
                    value={editRecurringForm.positionId || "__none__"}
                    onValueChange={v => setEditRecurringForm(f => ({ ...f, positionId: v === "__none__" ? "" : v }))}
                  >
                    <SelectTrigger data-testid="select-edit-recurring-position">
                      <SelectValue placeholder="Select position (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None</SelectItem>
                      {positions
                        .filter((p: any) => !p.companyId || p.companyId === editRecurringForm.companyId)
                        .filter((p: any) => p.isActive !== false)
                        .map((p: any) => (
                          <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Cost Center</label>
                  <Select
                    value={editRecurringForm.costCenterId || "__none__"}
                    onValueChange={(v) => setEditRecurringForm((f) => ({ ...f, costCenterId: v === "__none__" ? "" : v }))}
                  >
                    <SelectTrigger data-testid="select-edit-recurring-cost-center">
                      <SelectValue placeholder="Select cost center (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None</SelectItem>
                      {costCenters
                        .filter((cc: any) => !cc.companyId || cc.companyId === editRecurringForm.companyId)
                        .filter((cc: any) => cc.isActive !== false)
                        .map((cc: any) => (
                          <SelectItem key={cc.id} value={cc.id}>{cc.name}{cc.code ? ` (${cc.code})` : ""}</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Note</label>
                  <Input
                    value={editRecurringForm.note}
                    onChange={e => setEditRecurringForm(f => ({ ...f, note: e.target.value }))}
                    placeholder="Optional note"
                    data-testid="input-edit-recurring-note"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input type="checkbox" id="edit-recurring-active" checked={editRecurringForm.isActive}
                    onChange={e => setEditRecurringForm(f => ({ ...f, isActive: e.target.checked }))}
                    data-testid="checkbox-edit-recurring-active" className="h-4 w-4 rounded border" />
                  <label htmlFor="edit-recurring-active" className="text-sm">Active</label>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setEditRecurringOpen(false)} data-testid="button-cancel-edit-recurring">
                    Cancel
                  </Button>
                  <Button
                    onClick={() => editingRecurring && updateRecurringMutation.mutate({ id: editingRecurring.id, data: editRecurringForm })}
                    disabled={updateRecurringMutation.isPending}
                    data-testid="button-submit-edit-recurring"
                  >
                    {updateRecurringMutation.isPending ? "Saving..." : "Save Changes"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </TabsContent>

        <TabsContent value="labor" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Labor Cost Projection
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-3 items-end">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Company</label>
                  <Select value={laborCompany} onValueChange={setLaborCompany}>
                    <SelectTrigger className="w-48" data-testid="select-labor-company">
                      <SelectValue placeholder="Select company..." />
                    </SelectTrigger>
                    <SelectContent>
                      {companies.map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Start Date</label>
                  <input
                    type="date"
                    className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                    value={laborStart}
                    onChange={e => setLaborStart(e.target.value)}
                    data-testid="input-labor-start"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">End Date</label>
                  <input
                    type="date"
                    className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                    value={laborEnd}
                    onChange={e => setLaborEnd(e.target.value)}
                    data-testid="input-labor-end"
                  />
                </div>
              </div>

              {laborCompany === "all" ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <TrendingUp className="h-10 w-10 mb-3 opacity-30" />
                  <p className="text-sm font-medium">Select a company to view labor projection</p>
                </div>
              ) : laborLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : laborSummary.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Calendar className="h-10 w-10 mb-3 opacity-30" />
                  <p className="text-sm font-medium">No scheduled shifts for this period</p>
                  <p className="text-xs mt-1">Schedule workers to see projected labor costs.</p>
                </div>
              ) : (
                <>
                  {/* Summary cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <Card className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900">
                      <CardContent className="p-3">
                        <p className="text-xs text-muted-foreground">Scheduled Hours</p>
                        <p className="text-xl font-bold text-blue-700 dark:text-blue-400">
                          {laborSummary.reduce((s, r) => s + r.scheduledHours, 0).toFixed(1)}h
                        </p>
                      </CardContent>
                    </Card>
                    <Card className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900">
                      <CardContent className="p-3">
                        <p className="text-xs text-muted-foreground">Projected Labor Cost</p>
                        <p className="text-xl font-bold text-blue-700 dark:text-blue-400">
                          ${laborSummary.reduce((s, r) => s + r.scheduledCost, 0).toFixed(2)}
                        </p>
                      </CardContent>
                    </Card>
                    <Card className="bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900">
                      <CardContent className="p-3">
                        <p className="text-xs text-muted-foreground">Actual Hours</p>
                        <p className="text-xl font-bold text-emerald-700 dark:text-emerald-400">
                          {laborSummary.reduce((s, r) => s + r.actualHours, 0).toFixed(1)}h
                        </p>
                      </CardContent>
                    </Card>
                    <Card className="bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900">
                      <CardContent className="p-3">
                        <p className="text-xs text-muted-foreground">Actual Labor Cost</p>
                        <p className="text-xl font-bold text-emerald-700 dark:text-emerald-400">
                          ${laborSummary.reduce((s, r) => s + r.actualCost, 0).toFixed(2)}
                        </p>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Per-worker table */}
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Worker</TableHead>
                          <TableHead className="text-right">Shifts</TableHead>
                          <TableHead className="text-right">Sched. Hours</TableHead>
                          <TableHead className="text-right">Sched. Cost</TableHead>
                          <TableHead className="text-right">Actual Hours</TableHead>
                          <TableHead className="text-right">Actual Cost</TableHead>
                          <TableHead className="text-right">Variance</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {laborSummary.map((row: any) => {
                          const variance = row.actualCost - row.scheduledCost;
                          const pct = row.scheduledHours > 0
                            ? ((row.actualHours / row.scheduledHours) * 100).toFixed(0)
                            : null;
                          return (
                            <TableRow key={row.workerId} data-testid={`row-labor-${row.workerId}`}>
                              <TableCell className="font-medium">
                                <div className="flex items-center gap-2">
                                  <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary">
                                    {row.workerName.split(" ").map((n: string) => n[0]).join("").slice(0, 2)}
                                  </div>
                                  <div>
                                    <div className="text-sm">{row.workerName}</div>
                                    <div className="text-xs text-muted-foreground">${Number(row.payRate).toFixed(2)}/hr</div>
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell className="text-right text-sm">{row.shifts}</TableCell>
                              <TableCell className="text-right text-sm text-blue-700 dark:text-blue-400 font-medium">
                                {row.scheduledHours.toFixed(1)}h
                              </TableCell>
                              <TableCell className="text-right text-sm text-blue-700 dark:text-blue-400">
                                ${row.scheduledCost.toFixed(2)}
                              </TableCell>
                              <TableCell className="text-right text-sm text-emerald-700 dark:text-emerald-400 font-medium">
                                {row.actualHours.toFixed(1)}h
                                {pct && <span className="ml-1 text-xs text-muted-foreground">({pct}%)</span>}
                              </TableCell>
                              <TableCell className="text-right text-sm text-emerald-700 dark:text-emerald-400">
                                ${row.actualCost.toFixed(2)}
                              </TableCell>
                              <TableCell className="text-right text-sm">
                                <span className={variance > 0 ? "text-destructive font-medium" : variance < 0 ? "text-emerald-600 font-medium" : "text-muted-foreground"}>
                                  {variance > 0 ? "+" : ""}{variance.toFixed(2)}
                                </span>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="marketplace" className="space-y-4">
          <MarketplaceSection
            workers={workers}
            schedules={schedules}
            companies={companies}
            departments={departments}
            currentUser={currentUser}
            isAdminOrManager={isAdminOrManager}
            shiftOffers={shiftOffers}
            claimOfferMutation={claimOfferMutation}
            approveOfferMutation={approveOfferMutation}
            rejectOfferMutation={rejectOfferMutation}
            withdrawOfferMutation={withdrawOfferMutation}
            setRejectOfferId={setRejectOfferId}
            setRejectNote={setRejectNote}
            setRejectDialogOpen={setRejectDialogOpen}
          />
        </TabsContent>
      </Tabs>

      {/* Reject Shift Exchange Dialog */}
      <Dialog open={rejectDialogOpen} onOpenChange={(v) => { setRejectDialogOpen(v); if (!v) { setRejectOfferId(null); setRejectNote(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Shift Exchange</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Rejecting this request will keep the original employee on the shift. Both workers will be notified by email and text.</p>
            <div>
              <Label>Manager Note (optional)</Label>
              <Textarea
                data-testid="input-reject-note"
                placeholder="Add a reason or note for the employees..."
                value={rejectNote}
                onChange={e => setRejectNote(e.target.value)}
                className="mt-1"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => { setRejectDialogOpen(false); setRejectOfferId(null); setRejectNote(""); }}>Cancel</Button>
            <Button variant="destructive" data-testid="button-confirm-reject" disabled={rejectOfferMutation.isPending} onClick={() => { if (rejectOfferId) rejectOfferMutation.mutate({ offerId: rejectOfferId, managerNote: rejectNote }); }}>
              {rejectOfferMutation.isPending ? "Rejecting..." : "Reject Exchange"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={addScheduleOpen} onOpenChange={(v) => { setAddScheduleOpen(v); if (!v) setScheduleForm({ workerId: "", companyId: "", date: "", startTime: "", endTime: "", department: "", jobId: "", note: "" }); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Scheduled Shift</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Employee</Label>
              <Select
                value={scheduleForm.workerId}
                onValueChange={(v) => setScheduleForm((f) => ({ ...f, workerId: v }))}
              >
                <SelectTrigger data-testid="select-schedule-worker">
                  <SelectValue placeholder="Select employee" />
                </SelectTrigger>
                <SelectContent>
                  {workers.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.lastName}, {w.firstName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Company</Label>
              <Select
                value={scheduleForm.companyId}
                onValueChange={(v) => setScheduleForm((f) => ({ ...f, companyId: v }))}
              >
                <SelectTrigger data-testid="select-schedule-company">
                  <SelectValue placeholder="Select company" />
                </SelectTrigger>
                <SelectContent>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Date</Label>
              <Input
                type="date"
                value={scheduleForm.date}
                onChange={(e) => setScheduleForm((f) => ({ ...f, date: e.target.value }))}
                data-testid="input-schedule-date"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <Label>Start Time</Label>
                <Input
                  type="time"
                  value={scheduleForm.startTime}
                  onChange={(e) => setScheduleForm((f) => ({ ...f, startTime: e.target.value }))}
                  data-testid="input-schedule-start-time"
                />
              </div>
              <div>
                <Label>End Time</Label>
                <Input
                  type="time"
                  value={scheduleForm.endTime}
                  onChange={(e) => setScheduleForm((f) => ({ ...f, endTime: e.target.value }))}
                  data-testid="input-schedule-end-time"
                />
              </div>
            </div>
            <div>
              <Label>Department</Label>
              <Select
                value={scheduleForm.department || "__none__"}
                onValueChange={(v) => setScheduleForm((f) => ({ ...f, department: v === "__none__" ? "" : v }))}
              >
                <SelectTrigger data-testid="select-schedule-department">
                  <SelectValue placeholder="Select department (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {departments
                    .filter(d => !d.companyId || d.companyId === scheduleForm.companyId)
                    .map(d => (
                      <SelectItem key={d.id} value={d.name}>
                        {d.name}{!d.companyId ? " (All Companies)" : ""}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Job</Label>
              <Select
                value={scheduleForm.jobId || "__none__"}
                onValueChange={(v) => setScheduleForm((f) => ({ ...f, jobId: v === "__none__" ? "" : v }))}
              >
                <SelectTrigger data-testid="select-schedule-job">
                  <SelectValue placeholder="Select job (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {jobs
                    .filter((j: any) => !j.companyId || j.companyId === scheduleForm.companyId)
                    .map((j: any) => (
                      <SelectItem key={j.id} value={j.id}>
                        {j.name}{!j.companyId ? " (All Companies)" : ""}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Position</Label>
              <Select
                value={scheduleForm.positionId || "__none__"}
                onValueChange={(v) => setScheduleForm((f) => ({ ...f, positionId: v === "__none__" ? "" : v }))}
              >
                <SelectTrigger data-testid="select-schedule-position">
                  <SelectValue placeholder="Select position (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {positions
                    .filter((p: any) => !p.companyId || p.companyId === scheduleForm.companyId)
                    .filter((p: any) => p.isActive !== false)
                    .map((p: any) => (
                      <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Cost Center</Label>
              <Select
                value={scheduleForm.costCenterId || "__none__"}
                onValueChange={(v) => setScheduleForm((f) => ({ ...f, costCenterId: v === "__none__" ? "" : v }))}
              >
                <SelectTrigger data-testid="select-schedule-cost-center">
                  <SelectValue placeholder="Select cost center (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {costCenters
                    .filter((cc: any) => !cc.companyId || cc.companyId === scheduleForm.companyId)
                    .filter((cc: any) => cc.isActive !== false)
                    .map((cc: any) => (
                      <SelectItem key={cc.id} value={cc.id}>{cc.name}{cc.code ? ` (${cc.code})` : ""}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Note</Label>
              <Input
                value={scheduleForm.note}
                onChange={(e) => setScheduleForm((f) => ({ ...f, note: e.target.value }))}
                placeholder="Optional note"
                data-testid="input-schedule-note"
              />
            </div>
            <Button
              className="w-full"
              onClick={() => addScheduleMutation.mutate(scheduleForm)}
              disabled={addScheduleMutation.isPending || !scheduleForm.workerId || !scheduleForm.companyId || !scheduleForm.date || !scheduleForm.startTime || !scheduleForm.endTime}
              data-testid="button-submit-schedule"
            >
              {addScheduleMutation.isPending ? "Adding..." : "Add Shift"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={editScheduleOpen} onOpenChange={setEditScheduleOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Shift</DialogTitle>
          </DialogHeader>
          {editingSchedule && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {getWorkerName(workers, editingSchedule.workerId)} - {editingSchedule.date}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <Label>Start Time</Label>
                  <Input
                    type="time"
                    value={editForm.startTime}
                    onChange={(e) => setEditForm((f) => ({ ...f, startTime: e.target.value }))}
                    data-testid="input-edit-start-time"
                  />
                </div>
                <div>
                  <Label>End Time</Label>
                  <Input
                    type="time"
                    value={editForm.endTime}
                    onChange={(e) => setEditForm((f) => ({ ...f, endTime: e.target.value }))}
                    data-testid="input-edit-end-time"
                  />
                </div>
              </div>
              <div>
                <Label>Status</Label>
                <Select
                  value={editForm.status}
                  onValueChange={(v) => setEditForm((f) => ({ ...f, status: v }))}
                >
                  <SelectTrigger data-testid="select-edit-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="published">Published</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Department</Label>
                <Select
                  value={editForm.department || "__none__"}
                  onValueChange={(v) => setEditForm((f) => ({ ...f, department: v === "__none__" ? "" : v }))}
                >
                  <SelectTrigger data-testid="select-edit-department">
                    <SelectValue placeholder="Select department (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {departments
                      .filter(d => !d.companyId || d.companyId === editingSchedule?.companyId)
                      .map(d => (
                        <SelectItem key={d.id} value={d.name}>
                          {d.name}{!d.companyId ? " (All Companies)" : ""}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Job</Label>
                <Select
                  value={editForm.jobId || "__none__"}
                  onValueChange={(v) => setEditForm((f) => ({ ...f, jobId: v === "__none__" ? "" : v }))}
                >
                  <SelectTrigger data-testid="select-edit-job">
                    <SelectValue placeholder="Select job (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {jobs
                      .filter((j: any) => !j.companyId || j.companyId === editingSchedule?.companyId)
                      .map((j: any) => (
                        <SelectItem key={j.id} value={j.id}>
                          {j.name}{!j.companyId ? " (All Companies)" : ""}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Position</Label>
                <Select
                  value={editForm.positionId || "__none__"}
                  onValueChange={(v) => setEditForm((f) => ({ ...f, positionId: v === "__none__" ? "" : v }))}
                >
                  <SelectTrigger data-testid="select-edit-position">
                    <SelectValue placeholder="Select position (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {positions
                      .filter((p: any) => !p.companyId || p.companyId === editingSchedule?.companyId)
                      .filter((p: any) => p.isActive !== false)
                      .map((p: any) => (
                        <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Cost Center</Label>
                <Select
                  value={editForm.costCenterId || "__none__"}
                  onValueChange={(v) => setEditForm((f) => ({ ...f, costCenterId: v === "__none__" ? "" : v }))}
                >
                  <SelectTrigger data-testid="select-edit-cost-center">
                    <SelectValue placeholder="Select cost center (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {costCenters
                      .filter((cc: any) => !cc.companyId || cc.companyId === (editingSchedule as any)?.companyId)
                      .filter((cc: any) => cc.isActive !== false)
                      .map((cc: any) => (
                        <SelectItem key={cc.id} value={cc.id}>{cc.name}{cc.code ? ` (${cc.code})` : ""}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Note</Label>
                <Input
                  value={editForm.note}
                  onChange={(e) => setEditForm((f) => ({ ...f, note: e.target.value }))}
                  placeholder="Optional note"
                  data-testid="input-edit-note"
                />
              </div>
              <Button
                className="w-full"
                onClick={() => updateScheduleMutation.mutate({ id: editingSchedule.id, data: editForm })}
                disabled={updateScheduleMutation.isPending}
                data-testid="button-submit-edit"
              >
                {updateScheduleMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
