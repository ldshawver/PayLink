import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  CalendarDays,
  Plus,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
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
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Schedule, Worker, Company } from "@shared/schema";

const scheduleFormSchema = z.object({
  workerId: z.string().min(1, "Worker is required"),
  companyId: z.string().min(1, "Company is required"),
  date: z.string().min(1, "Date is required"),
  startTime: z.string().min(1, "Start time is required"),
  endTime: z.string().min(1, "End time is required"),
  department: z.string().optional(),
  note: z.string().optional(),
});

type ScheduleFormValues = z.infer<typeof scheduleFormSchema>;

function getWeekDates(offset: number) {
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay() + offset * 7);
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(startOfWeek);
    d.setDate(startOfWeek.getDate() + i);
    dates.push(d);
  }
  return dates;
}

function formatDateKey(d: Date) {
  return d.toISOString().split("T")[0];
}

export default function SchedulePage() {
  const [weekOffset, setWeekOffset] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const { toast } = useToast();

  const weekDates = getWeekDates(weekOffset);

  const { data: schedules, isLoading } = useQuery<Schedule[]>({
    queryKey: ["/api/schedules"],
  });

  const { data: workers } = useQuery<Worker[]>({
    queryKey: ["/api/workers"],
  });

  const { data: companies } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
  });

  const activeWorkers = (workers || []).filter((w) => w.isActive);
  const workerMap = new Map(workers?.map((w) => [w.id, w]) || []);

  const form = useForm<ScheduleFormValues>({
    resolver: zodResolver(scheduleFormSchema),
    defaultValues: {
      workerId: "",
      companyId: companies?.[0]?.id || "",
      date: formatDateKey(new Date()),
      startTime: "09:00",
      endTime: "17:00",
      department: "",
      note: "",
    },
  });

  const createSchedule = useMutation({
    mutationFn: async (data: ScheduleFormValues) => {
      await apiRequest("POST", "/api/schedules", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
      toast({ title: "Schedule added" });
      form.reset();
      setDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const schedulesByDateAndWorker = new Map<string, Schedule[]>();
  (schedules || []).forEach((s) => {
    const key = `${s.date}-${s.workerId}`;
    if (!schedulesByDateAndWorker.has(key)) {
      schedulesByDateAndWorker.set(key, []);
    }
    schedulesByDateAndWorker.get(key)!.push(s);
  });

  const weekLabel = `${weekDates[0].toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })} - ${weekDates[6].toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-schedule-title">
            Schedule
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage shifts and worker schedules.
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-schedule">
              <Plus className="h-4 w-4 mr-2" /> Add Shift
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Shift</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit((data) => createSchedule.mutate(data))}
                className="space-y-4"
              >
                <FormField
                  control={form.control}
                  name="workerId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Worker</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-schedule-worker">
                            <SelectValue placeholder="Select worker" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {activeWorkers.map((w) => (
                            <SelectItem key={w.id} value={w.id}>
                              {w.firstName} {w.lastName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="companyId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Company</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-schedule-company">
                            <SelectValue placeholder="Select company" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {companies?.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Date</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} data-testid="input-schedule-date" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="startTime"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Start Time</FormLabel>
                        <FormControl>
                          <Input type="time" {...field} data-testid="input-start-time" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="endTime"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>End Time</FormLabel>
                        <FormControl>
                          <Input type="time" {...field} data-testid="input-end-time" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={createSchedule.isPending}
                  data-testid="button-submit-schedule"
                >
                  {createSchedule.isPending ? "Adding..." : "Add Shift"}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setWeekOffset((o) => o - 1)}
          data-testid="button-prev-week"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium" data-testid="text-week-label">{weekLabel}</span>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setWeekOffset((o) => o + 1)}
          data-testid="button-next-week"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="p-6">
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full min-w-[700px]">
              <thead>
                <tr className="border-b">
                  <th className="p-3 text-left text-xs font-medium text-muted-foreground w-40">
                    Worker
                  </th>
                  {weekDates.map((d) => (
                    <th
                      key={d.toISOString()}
                      className={`p-3 text-center text-xs font-medium ${
                        formatDateKey(d) === formatDateKey(new Date())
                          ? "text-primary"
                          : "text-muted-foreground"
                      }`}
                    >
                      <div>{d.toLocaleDateString("en-US", { weekday: "short" })}</div>
                      <div className="text-sm font-semibold mt-0.5">
                        {d.getDate()}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeWorkers.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center">
                      <CalendarDays className="h-10 w-10 text-muted-foreground/30 mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">No workers to schedule</p>
                    </td>
                  </tr>
                ) : (
                  activeWorkers.map((worker) => (
                    <tr key={worker.id} className="border-b last:border-0">
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary">
                            {worker.firstName[0]}{worker.lastName[0]}
                          </div>
                          <span className="text-sm font-medium truncate max-w-[100px]">
                            {worker.firstName} {worker.lastName.charAt(0)}.
                          </span>
                        </div>
                      </td>
                      {weekDates.map((d) => {
                        const key = `${formatDateKey(d)}-${worker.id}`;
                        const daySchedules = schedulesByDateAndWorker.get(key) || [];
                        return (
                          <td key={d.toISOString()} className="p-2 text-center align-top">
                            {daySchedules.map((s) => (
                              <div
                                key={s.id}
                                className="bg-primary/10 text-primary text-xs rounded-md px-2 py-1 mb-1"
                                data-testid={`schedule-block-${s.id}`}
                              >
                                {s.startTime} - {s.endTime}
                              </div>
                            ))}
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
