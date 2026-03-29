import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Loader2, Search, Mail, Phone, MessageSquare, FileText, CheckCircle2,
  Activity, CreditCard, Headphones, Zap, LogIn, User
} from "lucide-react";
import type { EngagementEvent } from "@/lib/onboarding-types";
import { EVENT_TYPES, PRODUCTS } from "@/lib/onboarding-types";

function getEventIcon(type: string) {
  switch (type) {
    case "email": return <Mail className="h-4 w-4 text-blue-500" />;
    case "call": return <Phone className="h-4 w-4 text-green-500" />;
    case "meeting": return <MessageSquare className="h-4 w-4 text-purple-500" />;
    case "note": return <FileText className="h-4 w-4 text-gray-500" />;
    case "login": return <LogIn className="h-4 w-4 text-teal-500" />;
    case "task_completed": return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    case "document_signed": return <FileText className="h-4 w-4 text-indigo-500" />;
    case "payment": return <CreditCard className="h-4 w-4 text-amber-500" />;
    case "support_ticket": return <Headphones className="h-4 w-4 text-red-500" />;
    case "feature_activated": return <Zap className="h-4 w-4 text-yellow-500" />;
    default: return <Activity className="h-4 w-4 text-muted-foreground" />;
  }
}

function getEventColor(type: string) {
  switch (type) {
    case "email": return "bg-blue-100 dark:bg-blue-900/30";
    case "call": return "bg-green-100 dark:bg-green-900/30";
    case "meeting": return "bg-purple-100 dark:bg-purple-900/30";
    case "task_completed": return "bg-emerald-100 dark:bg-emerald-900/30";
    case "payment": return "bg-amber-100 dark:bg-amber-900/30";
    case "support_ticket": return "bg-red-100 dark:bg-red-900/30";
    case "feature_activated": return "bg-yellow-100 dark:bg-yellow-900/30";
    default: return "bg-muted";
  }
}

export default function EngagementFeedPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [productFilter, setProductFilter] = useState("all");

  const companyId = user?.companyId;

  const { data: events = [], isLoading } = useQuery<EngagementEvent[]>({
    queryKey: [`/api/engagement-events?companyId=${companyId}`],
    enabled: !!companyId,
  });

  const filtered = events.filter(e => {
    const matchesSearch = !search || e.title.toLowerCase().includes(search.toLowerCase()) ||
      e.customerName.toLowerCase().includes(search.toLowerCase()) ||
      (e.description && e.description.toLowerCase().includes(search.toLowerCase()));
    const matchesType = typeFilter === "all" || e.eventType === typeFilter;
    const matchesProduct = productFilter === "all" || e.product === productFilter;
    return matchesSearch && matchesType && matchesProduct;
  });

  const sortedEvents = [...filtered].sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const stats = {
    total: events.length,
    today: events.filter(e => {
      const eventDate = new Date(e.createdAt).toDateString();
      return eventDate === new Date().toDateString();
    }).length,
    thisWeek: events.filter(e => {
      const eventDate = new Date(e.createdAt);
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      return eventDate >= weekAgo;
    }).length,
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-page-title">Engagement Feed</h1>
        <p className="text-muted-foreground">Chronological stream of customer engagement events</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <Activity className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <div className="text-2xl font-bold" data-testid="text-total-events">{stats.total}</div>
              <div className="text-xs text-muted-foreground">Total Events</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <Activity className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <div className="text-2xl font-bold" data-testid="text-today-events">{stats.today}</div>
              <div className="text-xs text-muted-foreground">Today</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
              <Activity className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <div className="text-2xl font-bold" data-testid="text-week-events">{stats.thisWeek}</div>
              <div className="text-xs text-muted-foreground">This Week</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search events..." value={search} onChange={e => setSearch(e.target.value)}
            className="pl-10" data-testid="input-search-events" />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-44" data-testid="select-filter-type">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {EVENT_TYPES.map(t => (
              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={productFilter} onValueChange={setProductFilter}>
          <SelectTrigger className="w-44" data-testid="select-filter-product">
            <SelectValue placeholder="All products" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Products</SelectItem>
            {PRODUCTS.map(p => (
              <SelectItem key={p} value={p}>{p}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : sortedEvents.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Activity className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">No engagement events found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="relative">
          <div className="absolute left-6 top-0 bottom-0 w-px bg-border" />
          <div className="space-y-4">
            {sortedEvents.map(event => {
              const eventTypeLabel = EVENT_TYPES.find(t => t.value === event.eventType)?.label || event.eventType;
              return (
                <div key={event.id} className="relative pl-14" data-testid={`card-event-${event.id}`}>
                  <div className={`absolute left-3 top-3 h-7 w-7 rounded-full flex items-center justify-center z-10 ${getEventColor(event.eventType)}`}>
                    {getEventIcon(event.eventType)}
                  </div>
                  <Card className="hover:shadow-md transition-shadow">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-sm" data-testid={`text-event-title-${event.id}`}>{event.title}</p>
                          {event.description && (
                            <p className="text-xs text-muted-foreground mt-0.5">{event.description}</p>
                          )}
                          <div className="flex items-center gap-3 mt-2 flex-wrap">
                            <Link
                              href={`/customers?id=${event.customerId}`}
                              className="text-xs flex items-center gap-1 text-primary hover:underline cursor-pointer"
                              data-testid={`link-customer-${event.id}`}
                            >
                              <User className="h-3 w-3" /> {event.customerName}
                            </Link>
                            <Badge variant="outline" className="text-xs" data-testid={`badge-event-type-${event.id}`}>
                              {eventTypeLabel}
                            </Badge>
                            {event.product && (
                              <Badge variant="secondary" className="text-xs">{event.product}</Badge>
                            )}
                          </div>
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap" data-testid={`text-event-time-${event.id}`}>
                          {new Date(event.createdAt).toLocaleDateString()}{" "}
                          {new Date(event.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
