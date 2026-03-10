import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Clock, LogIn, LogOut, Coffee, CoffeeIcon, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import type { Worker, TimeEntry, TimePunch } from "@shared/schema";

function LiveTime() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <span className="text-xs font-mono tabular-nums text-muted-foreground hidden sm:inline">
      {time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
    </span>
  );
}

export function ClockInButton() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);

  const workersQuery = useQuery<Worker[]>({ queryKey: ["/api/workers"] });
  const entriesQuery = useQuery<TimeEntry[]>({ queryKey: ["/api/time-entries"] });
  const punchesQuery = useQuery<TimePunch[]>({ queryKey: ["/api/time-punches"] });

  const workers = workersQuery.data || [];

  const clockableWorkers = workers.filter(
    (w) => w.isActive && !(w.workerType === "contractor" && w.contractorType === "invoice")
  );

  const linkedWorker = workers.find(
    (w) => (user as any)?.workerId === w.id || w.email === user?.username || w.employeeNumber === user?.username
  );

  const activeWorker = selectedWorkerId
    ? clockableWorkers.find((w) => w.id === selectedWorkerId)
    : linkedWorker || null;

  const openEntry = activeWorker
    ? entriesQuery.data?.find(
        (e) => e.workerId === activeWorker.id && e.clockIn && !e.clockOut
      )
    : null;

  const todayPunches = activeWorker
    ? (punchesQuery.data || [])
        .filter((p) => p.workerId === activeWorker.id)
        .filter((p) => new Date(p.punchTime).toDateString() === new Date().toDateString())
        .sort((a, b) => new Date(b.punchTime).getTime() - new Date(a.punchTime).getTime())
    : [];

  const isOnBreak = todayPunches.length > 0 && todayPunches[0].punchType === "break_start";
  const isClockedIn = !!openEntry;

  const punchMutation = useMutation({
    mutationFn: async (punchType: string) => {
      if (!activeWorker) throw new Error("Select a worker first");
      await apiRequest("POST", "/api/time-punches", {
        workerId: activeWorker.id,
        companyId: activeWorker.companyId,
        punchType,
      });
    },
    onSuccess: (_, punchType) => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-punches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-entries"] });
      const labels: Record<string, string> = {
        clock_in: "Clocked In",
        clock_out: "Clocked Out",
        break_start: "Break Started",
        break_end: "Break Ended",
      };
      toast({ title: `${labels[punchType] || "Punch Recorded"} — ${activeWorker!.firstName} ${activeWorker!.lastName}` });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (clockableWorkers.length === 0) return null;

  const needsWorkerSelect = !linkedWorker;

  return (
    <div className="flex items-center gap-2">
      <LiveTime />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant={isClockedIn ? "default" : "outline"}
            size="sm"
            className="gap-1.5"
            data-testid="button-clock-toggle"
          >
            <Clock className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">
              {isClockedIn
                ? isOnBreak
                  ? "On Break"
                  : "Clocked In"
                : "Clock In"}
            </span>
            {isClockedIn && (
              <Badge variant="secondary" className="ml-0.5 text-[10px] px-1 py-0">
                LIVE
              </Badge>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64" data-testid="menu-clock-options">
          {needsWorkerSelect && (
            <>
              <DropdownMenuLabel className="text-xs">
                {activeWorker
                  ? `Worker: ${activeWorker.firstName} ${activeWorker.lastName}`
                  : "Select Worker"}
              </DropdownMenuLabel>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger data-testid="button-select-worker">
                  <ChevronDown className="mr-2 h-4 w-4" />
                  {activeWorker ? `${activeWorker.firstName} ${activeWorker.lastName}` : "Choose Worker..."}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-h-64 overflow-y-auto">
                  {clockableWorkers.map((w) => (
                    <DropdownMenuItem
                      key={w.id}
                      onClick={() => setSelectedWorkerId(w.id)}
                      data-testid={`button-select-worker-${w.id}`}
                    >
                      {w.firstName} {w.lastName}
                      <span className="ml-auto text-xs text-muted-foreground">
                        {w.employeeNumber || ""}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
            </>
          )}

          {!activeWorker ? (
            <DropdownMenuItem disabled className="text-muted-foreground text-xs">
              Select a worker to clock in
            </DropdownMenuItem>
          ) : !isClockedIn ? (
            <DropdownMenuItem
              onClick={() => punchMutation.mutate("clock_in")}
              disabled={punchMutation.isPending}
              data-testid="button-clock-in"
            >
              <LogIn className="mr-2 h-4 w-4 text-green-600" />
              Clock In
            </DropdownMenuItem>
          ) : (
            <>
              {!isOnBreak ? (
                <DropdownMenuItem
                  onClick={() => punchMutation.mutate("break_start")}
                  disabled={punchMutation.isPending}
                  data-testid="button-break-start"
                >
                  <Coffee className="mr-2 h-4 w-4 text-amber-600" />
                  Start Break
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  onClick={() => punchMutation.mutate("break_end")}
                  disabled={punchMutation.isPending}
                  data-testid="button-break-end"
                >
                  <CoffeeIcon className="mr-2 h-4 w-4 text-amber-600" />
                  End Break
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => punchMutation.mutate("clock_out")}
                disabled={punchMutation.isPending}
                data-testid="button-clock-out"
              >
                <LogOut className="mr-2 h-4 w-4 text-red-600" />
                Clock Out
              </DropdownMenuItem>
            </>
          )}

          {todayPunches.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <div className="px-2 py-1.5">
                <p className="text-xs font-medium text-muted-foreground mb-1">Today's Activity</p>
                {todayPunches.slice(0, 6).map((p) => (
                  <p key={p.id} className="text-xs text-muted-foreground flex justify-between gap-4">
                    <span>
                      {p.punchType === "clock_in"
                        ? "Clock In"
                        : p.punchType === "clock_out"
                          ? "Clock Out"
                          : p.punchType === "break_start"
                            ? "Break Start"
                            : "Break End"}
                    </span>
                    <span className="font-mono">
                      {new Date(p.punchTime).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </p>
                ))}
              </div>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
