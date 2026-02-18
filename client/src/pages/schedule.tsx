import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Schedule, Worker, Company, RecurringSchedule } from "@shared/schema";
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
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  FileText,
  Users,
  RefreshCw,
} from "lucide-react";

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

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

function formatDayHeader(d: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${days[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function getWorkerName(workers: Worker[], workerId: string): string {
  const w = workers.find((w) => w.id === workerId);
  return w ? `${w.firstName} ${w.lastName}` : "Unknown";
}

function useTabParam(defaultTab: string): [string, (tab: string) => void] {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(search);
  const tab = params.get("tab") || defaultTab;
  const setTab = (newTab: string) => {
    setLocation(`/schedule?tab=${newTab}`);
  };
  return [tab, setTab];
}

export default function SchedulePage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useTabParam("schedules");
  const [weekOffset, setWeekOffset] = useState(0);
  const [addScheduleOpen, setAddScheduleOpen] = useState(false);
  const [addRecurringOpen, setAddRecurringOpen] = useState(false);

  const [scheduleForm, setScheduleForm] = useState({
    workerId: "",
    companyId: "",
    date: "",
    startTime: "",
    endTime: "",
    department: "",
    note: "",
  });

  const [recurringForm, setRecurringForm] = useState({
    companyId: "",
    workerId: "",
    dayOfWeek: "",
    startTime: "",
    endTime: "",
    effectiveFrom: "",
    effectiveTo: "",
  });

  const baseDate = new Date();
  baseDate.setDate(baseDate.getDate() + weekOffset * 7);
  const weekDates = getWeekDates(baseDate);

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

  const addScheduleMutation = useMutation({
    mutationFn: async (data: typeof scheduleForm) => {
      await apiRequest("POST", "/api/schedules", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
      setAddScheduleOpen(false);
      setScheduleForm({ workerId: "", companyId: "", date: "", startTime: "", endTime: "", department: "", note: "" });
      toast({ title: "Schedule added", description: "The schedule has been created." });
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
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-schedules"] });
      setAddRecurringOpen(false);
      setRecurringForm({ companyId: "", workerId: "", dayOfWeek: "", startTime: "", endTime: "", effectiveFrom: "", effectiveTo: "" });
      toast({ title: "Recurring schedule added", description: "The recurring schedule has been created." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    const url = value === "schedules" ? "/schedule" : `/schedule?tab=${value}`;
    setLocation(url);
  };

  const isLoading = schedulesLoading || workersLoading || companiesLoading;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Schedule</h1>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList data-testid="tabs-schedule">
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
          <TabsTrigger value="templates" data-testid="tab-templates">
            <FileText className="h-4 w-4 mr-1" />
            Recurring Templates
          </TabsTrigger>
        </TabsList>

        <TabsContent value="schedules" className="space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Button
                size="icon"
                variant="outline"
                onClick={() => setWeekOffset((w) => w - 1)}
                data-testid="button-prev-week"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm font-medium" data-testid="text-week-range">
                {formatDate(weekDates[0])} — {formatDate(weekDates[6])}
              </span>
              <Button
                size="icon"
                variant="outline"
                onClick={() => setWeekOffset((w) => w + 1)}
                data-testid="button-next-week"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setWeekOffset(0)}
                data-testid="button-today"
              >
                Today
              </Button>
            </div>

            <Dialog open={addScheduleOpen} onOpenChange={setAddScheduleOpen}>
              <DialogTrigger asChild>
                <Button data-testid="button-add-schedule">
                  <Plus className="h-4 w-4 mr-1" />
                  Add Schedule
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Schedule</DialogTitle>
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
                            {w.firstName} {w.lastName}
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
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
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
                  <div className="grid grid-cols-2 gap-2">
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
                    <Input
                      value={scheduleForm.department}
                      onChange={(e) => setScheduleForm((f) => ({ ...f, department: e.target.value }))}
                      placeholder="Department"
                      data-testid="input-schedule-department"
                    />
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
                    {addScheduleMutation.isPending ? "Adding..." : "Add Schedule"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-7 gap-2" data-testid="skeleton-week-view">
              {Array.from({ length: 7 }).map((_, i) => (
                <Skeleton key={i} className="h-40 rounded-md" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-7 gap-2">
              {weekDates.map((date) => {
                const dateStr = formatDate(date);
                const daySchedules = schedules.filter((s) => s.date === dateStr);
                const isToday = formatDate(new Date()) === dateStr;

                return (
                  <Card
                    key={dateStr}
                    className={isToday ? "border-primary" : ""}
                    data-testid={`card-day-${dateStr}`}
                  >
                    <CardHeader className="p-2 pb-1">
                      <CardTitle className="text-xs font-medium">
                        {formatDayHeader(date)}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-2 pt-0 space-y-1">
                      {daySchedules.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No shifts</p>
                      ) : (
                        daySchedules.map((s) => (
                          <div
                            key={s.id}
                            className="rounded-md bg-muted p-1.5 space-y-0.5"
                            data-testid={`schedule-entry-${s.id}`}
                          >
                            <div className="flex items-center gap-1 flex-wrap">
                              <Users className="h-3 w-3 text-muted-foreground shrink-0" />
                              <span className="text-xs font-medium truncate">
                                {getWorkerName(workers, s.workerId)}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {s.startTime} - {s.endTime}
                            </p>
                            {s.department && (
                              <p className="text-xs text-muted-foreground truncate">{s.department}</p>
                            )}
                            <Badge variant="secondary" className="text-[10px]" data-testid={`badge-status-${s.id}`}>
                              {s.status}
                            </Badge>
                          </div>
                        ))
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="shifts">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Scheduled Shifts
              </CardTitle>
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
                      <TableHead>Date</TableHead>
                      <TableHead>Start Time</TableHead>
                      <TableHead>End Time</TableHead>
                      <TableHead>Department</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {schedules.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground">
                          No scheduled shifts found.
                        </TableCell>
                      </TableRow>
                    ) : (
                      schedules.map((s) => (
                        <TableRow key={s.id} data-testid={`row-shift-${s.id}`}>
                          <TableCell data-testid={`text-employee-${s.id}`}>
                            {getWorkerName(workers, s.workerId)}
                          </TableCell>
                          <TableCell>{s.date}</TableCell>
                          <TableCell>{s.startTime}</TableCell>
                          <TableCell>{s.endTime}</TableCell>
                          <TableCell>{s.department || "—"}</TableCell>
                          <TableCell>
                            <Badge
                              variant={s.status === "published" ? "default" : "secondary"}
                              data-testid={`badge-shift-status-${s.id}`}
                            >
                              {s.status}
                            </Badge>
                          </TableCell>
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
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
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
                        <SelectValue placeholder="Select employee" />
                      </SelectTrigger>
                      <SelectContent>
                        {workers.map((w) => (
                          <SelectItem key={w.id} value={w.id}>
                            {w.firstName} {w.lastName}
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
                          <SelectItem key={i} value={String(i)}>
                            {name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
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
                  <div className="grid grid-cols-2 gap-2">
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

          <Card>
            <CardContent className="pt-4">
              {recurringLoading || workersLoading ? (
                <div className="space-y-2" data-testid="skeleton-recurring-table">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : (
                <Table data-testid="table-recurring">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Day of Week</TableHead>
                      <TableHead>Start Time</TableHead>
                      <TableHead>End Time</TableHead>
                      <TableHead>Effective From</TableHead>
                      <TableHead>Effective To</TableHead>
                      <TableHead>Active</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recurringSchedules.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground">
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
                          <TableCell>{rs.startTime}</TableCell>
                          <TableCell>{rs.endTime}</TableCell>
                          <TableCell>{rs.effectiveFrom || "—"}</TableCell>
                          <TableCell>{rs.effectiveTo || "—"}</TableCell>
                          <TableCell>
                            <Badge
                              variant={rs.isActive ? "default" : "secondary"}
                              data-testid={`badge-recurring-active-${rs.id}`}
                            >
                              {rs.isActive ? "Active" : "Inactive"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="templates">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Recurring Templates
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground" data-testid="text-templates-placeholder">
                Recurring schedule templates for common shift patterns.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
