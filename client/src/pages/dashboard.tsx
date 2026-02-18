import { useQuery } from "@tanstack/react-query";
import {
  Users,
  Clock,
  DollarSign,
  CalendarDays,
  TrendingUp,
  UserCheck,
  AlertTriangle,
  ArrowUpRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { Worker, TimeEntry } from "@shared/schema";

interface DashboardStats {
  totalEmployees: number;
  totalContractors: number;
  activeToday: number;
  pendingTimesheets: number;
  totalHoursThisWeek: number;
  overtimeHoursThisWeek: number;
}

function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  loading,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: any;
  trend?: string;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <Card>
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-2 flex-1">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-7 w-16" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-10 w-10 rounded-md" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
            <p className="text-2xl font-bold tracking-tight">{value}</p>
            {subtitle && (
              <p className="text-xs text-muted-foreground flex items-center gap-1 flex-wrap">
                {trend && <ArrowUpRight className="h-3 w-3 text-primary" />}
                {subtitle}
              </p>
            )}
          </div>
          <div className="rounded-md bg-primary/10 p-2.5">
            <Icon className="h-5 w-5 text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function RecentActivityCard({ loading }: { loading: boolean }) {
  const { data: entries } = useQuery<TimeEntry[]>({
    queryKey: ["/api/time-entries"],
  });

  const { data: workers } = useQuery<Worker[]>({
    queryKey: ["/api/workers"],
  });

  const workerMap = new Map(workers?.map((w) => [w.id, w]) || []);

  const recentEntries = (entries || [])
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    .slice(0, 5);

  if (loading) {
    return (
      <Card className="col-span-full lg:col-span-2">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-8 w-8 rounded-full" />
              <div className="flex-1 space-y-1">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-3 w-20" />
              </div>
              <Skeleton className="h-5 w-14" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="col-span-full lg:col-span-2">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">Recent Time Entries</CardTitle>
      </CardHeader>
      <CardContent>
        {recentEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Clock className="h-8 w-8 text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">No time entries yet</p>
            <p className="text-xs text-muted-foreground/70 mt-1">Clock in to start tracking time</p>
          </div>
        ) : (
          <div className="space-y-3">
            {recentEntries.map((entry) => {
              const worker = workerMap.get(entry.workerId);
              return (
                <div key={entry.id} className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary">
                    {worker
                      ? `${worker.firstName[0]}${worker.lastName[0]}`
                      : "??"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {worker
                        ? `${worker.firstName} ${worker.lastName}`
                        : "Unknown"}
                    </p>
                    <p className="text-xs text-muted-foreground">{entry.date}</p>
                  </div>
                  <Badge variant="secondary" className="text-xs">
                    {Number(entry.totalHours || 0).toFixed(1)}h
                  </Badge>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function QuickActionsCard() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">Quick Actions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {[
          { label: "Clock In/Out", href: "/time-clock", icon: Clock },
          { label: "Add Employee", href: "/employees", icon: Users },
          { label: "View Timesheets", href: "/timesheets", icon: CalendarDays },
          { label: "Company Settings", href: "/company", icon: DollarSign },
        ].map((action) => (
          <a
            key={action.label}
            href={action.href}
            className="flex items-center gap-3 p-2.5 rounded-md hover-elevate cursor-pointer"
            data-testid={`link-quick-${action.label.toLowerCase().replace(/[\s/]/g, "-")}`}
          >
            <action.icon className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">{action.label}</span>
          </a>
        ))}
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats"],
  });

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-dashboard-title">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Welcome to PayLink. Here's an overview of your workforce.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Employees"
          value={stats?.totalEmployees ?? 0}
          subtitle="Active workforce"
          icon={Users}
          loading={isLoading}
        />
        <StatCard
          title="Contractors"
          value={stats?.totalContractors ?? 0}
          subtitle="Independent workers"
          icon={UserCheck}
          loading={isLoading}
        />
        <StatCard
          title="Hours This Week"
          value={Number(stats?.totalHoursThisWeek ?? 0).toFixed(1)}
          subtitle={`${Number(stats?.overtimeHoursThisWeek ?? 0).toFixed(1)}h overtime`}
          icon={TrendingUp}
          trend="up"
          loading={isLoading}
        />
        <StatCard
          title="Pending Review"
          value={stats?.pendingTimesheets ?? 0}
          subtitle="Timesheets awaiting approval"
          icon={AlertTriangle}
          loading={isLoading}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <RecentActivityCard loading={isLoading} />
        <QuickActionsCard />
      </div>
    </div>
  );
}
