import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Clock,
  Play,
  Square,
  Coffee,
  ArrowRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Worker, TimePunch } from "@shared/schema";

function LiveClock() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="text-center">
      <p className="text-5xl font-bold tracking-tight tabular-nums" data-testid="text-live-clock">
        {time.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: true,
        })}
      </p>
      <p className="text-sm text-muted-foreground mt-1">
        {time.toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
        })}
      </p>
    </div>
  );
}

function PunchButton({
  type,
  icon: Icon,
  label,
  variant,
  workerId,
  companyId,
  disabled,
}: {
  type: string;
  icon: any;
  label: string;
  variant: "default" | "destructive" | "secondary";
  workerId: string;
  companyId: string;
  disabled?: boolean;
}) {
  const { toast } = useToast();

  const punchMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/time-punches", {
        workerId,
        companyId,
        punchType: type,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-punches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: `${label} recorded` });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  return (
    <Button
      variant={variant}
      className="flex-1 h-14"
      onClick={() => punchMutation.mutate()}
      disabled={disabled || punchMutation.isPending}
      data-testid={`button-punch-${type}`}
    >
      <Icon className="h-5 w-5 mr-2" />
      {punchMutation.isPending ? "..." : label}
    </Button>
  );
}

export default function TimeClock() {
  const [selectedWorker, setSelectedWorker] = useState<string>("");

  const { data: workers, isLoading: workersLoading } = useQuery<Worker[]>({
    queryKey: ["/api/workers"],
  });

  const { data: punches } = useQuery<TimePunch[]>({
    queryKey: ["/api/time-punches"],
  });

  const activeWorkers = (workers || []).filter((w) => w.isActive);

  const selectedWorkerData = workers?.find((w) => w.id === selectedWorker);
  const workerPunches = (punches || [])
    .filter((p) => p.workerId === selectedWorker)
    .sort((a, b) => new Date(b.punchTime).getTime() - new Date(a.punchTime).getTime());

  const lastPunch = workerPunches[0];
  const isClockedIn = lastPunch?.punchType === "clock_in" || lastPunch?.punchType === "break_end";
  const isOnBreak = lastPunch?.punchType === "break_start";

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-timeclock-title">Time Clock</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Clock in and out, take breaks, and track your time.
        </p>
      </div>

      <Card>
        <CardContent className="p-8">
          <LiveClock />

          <div className="mt-8 max-w-sm mx-auto">
            <label className="text-sm font-medium mb-2 block">Select Worker</label>
            {workersLoading ? (
              <Skeleton className="h-9 w-full" />
            ) : (
              <Select value={selectedWorker} onValueChange={setSelectedWorker}>
                <SelectTrigger data-testid="select-worker">
                  <SelectValue placeholder="Choose a worker..." />
                </SelectTrigger>
                <SelectContent>
                  {activeWorkers.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.firstName} {w.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {selectedWorker && selectedWorkerData && (
            <div className="mt-6 space-y-4">
              <div className="flex items-center justify-center gap-2">
                <Badge
                  variant={isClockedIn ? "default" : isOnBreak ? "secondary" : "destructive"}
                  data-testid="badge-clock-status"
                >
                  {isClockedIn ? "Clocked In" : isOnBreak ? "On Break" : "Clocked Out"}
                </Badge>
              </div>

              <div className="flex gap-3 max-w-md mx-auto">
                {!isClockedIn && !isOnBreak ? (
                  <PunchButton
                    type="clock_in"
                    icon={Play}
                    label="Clock In"
                    variant="default"
                    workerId={selectedWorker}
                    companyId={selectedWorkerData.companyId}
                  />
                ) : (
                  <>
                    {isClockedIn && (
                      <PunchButton
                        type="break_start"
                        icon={Coffee}
                        label="Start Break"
                        variant="secondary"
                        workerId={selectedWorker}
                        companyId={selectedWorkerData.companyId}
                      />
                    )}
                    {isOnBreak && (
                      <PunchButton
                        type="break_end"
                        icon={ArrowRight}
                        label="End Break"
                        variant="secondary"
                        workerId={selectedWorker}
                        companyId={selectedWorkerData.companyId}
                      />
                    )}
                    <PunchButton
                      type="clock_out"
                      icon={Square}
                      label="Clock Out"
                      variant="destructive"
                      workerId={selectedWorker}
                      companyId={selectedWorkerData.companyId}
                    />
                  </>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedWorker && workerPunches.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Recent Punches</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {workerPunches.slice(0, 10).map((punch) => (
                <div
                  key={punch.id}
                  className="flex items-center justify-between py-2 border-b last:border-0"
                  data-testid={`row-punch-${punch.id}`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`h-2 w-2 rounded-full ${
                      punch.punchType === "clock_in" ? "bg-green-500" :
                      punch.punchType === "clock_out" ? "bg-red-500" :
                      "bg-yellow-500"
                    }`} />
                    <span className="text-sm font-medium capitalize">
                      {punch.punchType.replace("_", " ")}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(punch.punchTime).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
