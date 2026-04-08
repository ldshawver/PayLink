import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  MessageSquare,
  Send,
  Inbox,
  PenSquare,
  ChevronLeft,
  Reply,
  Users,
  Globe,
  User,
  Clock,
  MailOpen,
  Mail,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

function formatInTimezone(date: Date, timezone: string, fmt: string): string {
  try {
    if (fmt === "relative") {
      return formatDistanceToNow(date, { addSuffix: true });
    }
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(date);
  }
}

interface Message {
  id: string;
  company_id: string | null;
  sender_id: string;
  sender_name: string;
  recipient_name: string | null;
  subject: string;
  body: string;
  scope: string;
  recipient_worker_id: string | null;
  delivery_channel: string;
  parent_message_id: string | null;
  is_reply: boolean;
  created_at: string;
  read_at: string | null;
  reply_count: number;
  replies?: Message[];
}

interface Worker {
  id: string;
  first_name: string;
  last_name: string;
  company_id: string;
  company_name: string;
}

const DELIVERY_OPTIONS = [
  { value: "app", label: "In-app only" },
  { value: "email", label: "Email" },
  { value: "sms", label: "Text (SMS)" },
  { value: "both", label: "Email & Text" },
];

const SCOPE_OPTIONS = [
  { value: "one", label: "Individual", icon: User },
  { value: "company", label: "Entire Company", icon: Users },
  { value: "sitewide", label: "All Staff (Site-wide)", icon: Globe },
];

function ComposeDialog({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const role = (user as any)?.role || "employee";
  const canBroadcast = ["admin", "manager", "supervisor"].includes(role);

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [scope, setScope] = useState("one");
  const [recipientId, setRecipientId] = useState("");
  const [deliveryChannel, setDeliveryChannel] = useState("email");
  const [workerSearch, setWorkerSearch] = useState("");

  const { data: notifStatus } = useQuery<{ sms: { configured: boolean }; email: { configured: boolean } }>({
    queryKey: ["/api/admin/notification-status"],
    enabled: canBroadcast,
  });

  const { data: workers = [] } = useQuery<Worker[]>({
    queryKey: ["/api/messages/workers"],
    enabled: scope === "one",
  });

  const filteredWorkers = (workers as Worker[]).filter((w) => {
    const name = `${w.first_name} ${w.last_name}`.toLowerCase();
    return name.includes(workerSearch.toLowerCase());
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/messages", {
        subject,
        body,
        scope,
        recipientWorkerId: scope === "one" ? recipientId : undefined,
        deliveryChannel: canBroadcast ? deliveryChannel : "app",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Failed to send");
      }
      // 207 = message saved but external delivery failed
      if (res.status === 207) {
        return { partial: true, data };
      }
      return { partial: false, data };
    },
    onSuccess: (result: any) => {
      if (result?.partial) {
        const summary = result.data?.deliverySummary;
        const partialSuccess = result.data?.partialSuccess;
        let description = result.data?.error || "Some recipients may not have received external delivery.";
        if (summary) {
          const parts = [];
          if (summary.emailSent > 0) parts.push(`${summary.emailSent} email${summary.emailSent > 1 ? "s" : ""} sent`);
          if (summary.emailFailed > 0) parts.push(`${summary.emailFailed} email${summary.emailFailed > 1 ? "s" : ""} failed`);
          if (summary.smsSent > 0) parts.push(`${summary.smsSent} SMS sent`);
          if (summary.smsFailed > 0) parts.push(`${summary.smsFailed} SMS failed`);
          if (parts.length) description = parts.join(", ") + ". Recipients can see the message in-app.";
        }
        toast({
          title: partialSuccess ? "Message sent with some failures" : "Message saved — delivery failed",
          description,
          variant: "destructive",
        });
      } else {
        toast({ title: "Message sent" });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/messages/unread-count"] });
      onSent();
    },
    onError: (err: any) => {
      toast({ title: err.message || "Failed to send message", variant: "destructive" });
    },
  });

  const canSubmit =
    subject.trim() &&
    body.trim() &&
    (scope !== "one" || recipientId);

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <PenSquare className="h-5 w-5 text-teal-600" />
          New Message
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-4 py-2">
        {canBroadcast && (
          <div className="space-y-2">
            <Label>Send To</Label>
            <div className="flex gap-2">
              {SCOPE_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.value}
                    data-testid={`scope-${opt.value}`}
                    onClick={() => { setScope(opt.value); setRecipientId(""); }}
                    className={cn(
                      "flex-1 flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-xs font-medium transition-colors",
                      scope === opt.value
                        ? "border-teal-500 bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300"
                        : "border-border hover:bg-muted"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {scope === "one" && (
          <div className="space-y-2">
            <Label>Recipient</Label>
            <Input
              placeholder="Search by name..."
              value={workerSearch}
              onChange={(e) => setWorkerSearch(e.target.value)}
              data-testid="input-worker-search"
            />
            <div className="max-h-40 overflow-y-auto rounded-md border">
              {filteredWorkers.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">No workers found</p>
              ) : (
                filteredWorkers.map((w) => (
                  <button
                    key={w.id}
                    data-testid={`worker-option-${w.id}`}
                    onClick={() => { setRecipientId(w.id); setWorkerSearch(`${w.first_name} ${w.last_name}`); }}
                    className={cn(
                      "w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors border-b last:border-b-0",
                      recipientId === w.id && "bg-teal-50 dark:bg-teal-950 font-medium"
                    )}
                  >
                    <span className="font-medium">{w.first_name} {w.last_name}</span>
                    {w.company_name && <span className="ml-2 text-xs text-muted-foreground">{w.company_name}</span>}
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label>Subject</Label>
          <Input
            placeholder="Message subject..."
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            data-testid="input-message-subject"
          />
        </div>

        <div className="space-y-2">
          <Label>Message</Label>
          <Textarea
            placeholder="Write your message..."
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            data-testid="textarea-message-body"
          />
        </div>

        {canBroadcast && (
          <div className="space-y-2">
            <Label>Delivery Channel</Label>
            <Select value={deliveryChannel} onValueChange={setDeliveryChannel}>
              <SelectTrigger data-testid="select-delivery-channel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DELIVERY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Live status warnings based on server config */}
            {notifStatus && (
              <div className="space-y-1">
                {(deliveryChannel === "email" || deliveryChannel === "both") && (
                  notifStatus.email.configured ? (
                    <div className="flex items-center gap-1.5 text-xs text-green-600">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Email is configured and will be delivered
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-xs text-orange-600">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Email is not configured — recipients will only see this in-app
                    </div>
                  )
                )}
                {(deliveryChannel === "sms" || deliveryChannel === "both") && (
                  notifStatus.sms.configured ? (
                    <div className="flex items-center gap-1.5 text-xs text-green-600">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      SMS is configured and will be delivered to workers with a phone number
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-xs text-orange-600">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      SMS (Twilio) is not configured — texts will not be sent
                    </div>
                  )
                )}
                {deliveryChannel === "app" && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Mail className="h-3.5 w-3.5" />
                    In-app only — no email or text will be sent
                  </div>
                )}
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              All messages appear in-app. Email and text are sent to any recipient who has that contact info on file.
            </p>
          </div>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} data-testid="button-cancel-compose">Cancel</Button>
        <Button
          onClick={() => sendMutation.mutate()}
          disabled={!canSubmit || sendMutation.isPending}
          className="bg-teal-600 hover:bg-teal-700"
          data-testid="button-send-message"
        >
          <Send className="h-4 w-4 mr-2" />
          {sendMutation.isPending ? "Sending..." : "Send"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function MessageThread({ message, onBack, timezone }: { message: Message; onBack: () => void; timezone?: string }) {
  const { toast } = useToast();
  const [replyBody, setReplyBody] = useState("");
  const [showReply, setShowReply] = useState(false);

  const { data: detail, isLoading } = useQuery<Message>({
    queryKey: ["/api/messages", message.id],
    queryFn: async () => {
      const res = await fetch(`/api/messages/${message.id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const markReadMutation = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/messages/${message.id}/read`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/messages/unread-count"] });
    },
  });

  const replyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/messages/${message.id}/reply`, { body: replyBody });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Reply sent" });
      setReplyBody("");
      setShowReply(false);
      queryClient.invalidateQueries({ queryKey: ["/api/messages", message.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
    },
    onError: (err: any) => {
      toast({ title: err.message || "Failed to send reply", variant: "destructive" });
    },
  });

  const msg = detail || message;

  // Mark as read when viewing
  if (message.read_at === null) {
    markReadMutation.mutate();
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 p-4 border-b">
        <Button variant="ghost" size="icon" onClick={onBack} data-testid="button-back-to-inbox">
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-base truncate">{msg.subject}</h2>
          <p className="text-xs text-muted-foreground">
            From {msg.sender_name}
            {msg.scope !== "one" && (
              <span className="ml-2">
                <Badge variant="secondary" className="text-xs">
                  {msg.scope === "company" ? "Company-wide" : "All Staff"}
                </Badge>
              </span>
            )}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <MessageBubble msg={msg} isFirst timezone={timezone} />
        {isLoading && <p className="text-sm text-muted-foreground text-center py-2">Loading replies...</p>}
        {msg.replies?.map((reply) => (
          <MessageBubble key={reply.id} msg={reply} timezone={timezone} />
        ))}
      </div>

      <div className="p-4 border-t">
        {showReply ? (
          <div className="space-y-2">
            <Textarea
              placeholder="Write a reply..."
              value={replyBody}
              onChange={(e) => setReplyBody(e.target.value)}
              rows={3}
              data-testid="textarea-reply-body"
            />
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => { setShowReply(false); setReplyBody(""); }}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => replyMutation.mutate()}
                disabled={!replyBody.trim() || replyMutation.isPending}
                className="bg-teal-600 hover:bg-teal-700"
                data-testid="button-send-reply"
              >
                <Send className="h-4 w-4 mr-1" />
                {replyMutation.isPending ? "Sending..." : "Send Reply"}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowReply(true)}
            data-testid="button-show-reply"
          >
            <Reply className="h-4 w-4 mr-2" />
            Reply
          </Button>
        )}
      </div>
    </div>
  );
}

function MessageBubble({ msg, isFirst, timezone }: { msg: Message; isFirst?: boolean; timezone?: string }) {
  const tz = timezone || "America/New_York";
  const createdAt = msg.created_at ? new Date(msg.created_at) : null;
  return (
    <div className={cn("rounded-lg border p-4", isFirst ? "bg-card" : "bg-muted/40")}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-full bg-gradient-to-br from-teal-500 to-blue-600 flex items-center justify-center text-white text-xs font-bold">
            {msg.sender_name?.charAt(0) || "?"}
          </div>
          <div>
            <p className="text-sm font-medium">{msg.sender_name}</p>
            {createdAt && (
              <p className="text-xs text-muted-foreground">
                {formatDistanceToNow(createdAt, { addSuffix: true })}
                <span className="ml-2 opacity-70">{formatInTimezone(createdAt, tz, "display")}</span>
              </p>
            )}
          </div>
        </div>
        {isFirst && msg.delivery_channel !== "app" && (
          <Badge variant="outline" className="text-xs capitalize">
            {msg.delivery_channel === "both" ? "Email & SMS" : msg.delivery_channel}
          </Badge>
        )}
      </div>
      <p className="text-sm text-foreground whitespace-pre-wrap">{msg.body}</p>
    </div>
  );
}

function MessageRow({
  msg,
  selected,
  onSelect,
  timezone,
}: {
  msg: Message;
  selected: boolean;
  onSelect: () => void;
  timezone?: string;
}) {
  const tz = timezone || "America/New_York";
  const createdAt = msg.created_at ? new Date(msg.created_at) : null;
  const isUnread = !msg.read_at;

  return (
    <button
      onClick={onSelect}
      data-testid={`message-row-${msg.id}`}
      className={cn(
        "w-full text-left px-4 py-3 border-b hover:bg-muted/50 transition-colors",
        selected && "bg-teal-50 dark:bg-teal-950 border-l-2 border-l-teal-500",
        isUnread && !selected && "bg-blue-50/40 dark:bg-blue-950/20"
      )}
    >
      <div className="flex items-start gap-2">
        <div className="mt-0.5">
          {isUnread ? (
            <Mail className="h-4 w-4 text-teal-600" />
          ) : (
            <MailOpen className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-0.5">
            <p className={cn("text-sm truncate", isUnread ? "font-semibold" : "font-medium")}>
              {msg.sender_name}
            </p>
            <div className="flex items-center gap-1 shrink-0">
              {msg.reply_count > 0 && (
                <Badge variant="secondary" className="text-xs h-4 px-1">
                  {msg.reply_count} {msg.reply_count === 1 ? "reply" : "replies"}
                </Badge>
              )}
              {createdAt && (
                <span className="text-xs text-muted-foreground" title={formatInTimezone(createdAt, tz, "display")}>
                  {formatDistanceToNow(createdAt, { addSuffix: true })}
                </span>
              )}
            </div>
          </div>
          <p className={cn("text-sm truncate", isUnread ? "text-foreground" : "text-muted-foreground")}>
            {msg.subject}
          </p>
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {msg.scope === "company"
              ? "Company-wide message"
              : msg.scope === "sitewide"
              ? "All staff message"
              : msg.body.substring(0, 80)}
          </p>
        </div>
      </div>
    </button>
  );
}

export default function MessagesPage() {
  const { user } = useAuth();
  const role = (user as any)?.role || "employee";
  const companyId = (user as any)?.companyId;
  const [folder, setFolder] = useState<"inbox" | "sent">("inbox");
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [showCompose, setShowCompose] = useState(false);

  const { data: messages = [], isLoading } = useQuery<Message[]>({
    queryKey: ["/api/messages", folder],
    queryFn: async () => {
      const res = await fetch(`/api/messages?folder=${folder}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const { data: unreadCount } = useQuery<{ count: number }>({
    queryKey: ["/api/messages/unread-count"],
  });

  const { data: companyData } = useQuery<{ timezone?: string }>({
    queryKey: ["/api/companies", companyId],
    queryFn: async () => {
      if (!companyId) return {};
      const res = await fetch(`/api/companies/${companyId}`, { credentials: "include" });
      if (!res.ok) return {};
      return res.json();
    },
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
  });

  const companyTimezone = companyData?.timezone || "America/New_York";

  const unread = unreadCount?.count ?? 0;

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <div className="flex items-center justify-between px-6 py-4 border-b">
        <div className="flex items-center gap-3">
          <MessageSquare className="h-6 w-6 text-teal-600" />
          <div>
            <h1 className="text-xl font-bold">Messages</h1>
            <p className="text-sm text-muted-foreground">
              Staff messaging &amp; communication
            </p>
          </div>
          {unread > 0 && (
            <Badge className="bg-teal-600 text-white text-xs">{unread} unread</Badge>
          )}
        </div>
        <Button
          onClick={() => setShowCompose(true)}
          className="bg-teal-600 hover:bg-teal-700"
          data-testid="button-compose"
        >
          <PenSquare className="h-4 w-4 mr-2" />
          New Message
        </Button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar: folder + message list */}
        <div className={cn(
          "flex flex-col border-r",
          selectedMessage ? "hidden md:flex md:w-72 lg:w-80" : "flex w-full md:w-72 lg:w-80"
        )}>
          {/* Folder tabs */}
          <div className="flex border-b">
            <button
              onClick={() => { setFolder("inbox"); setSelectedMessage(null); }}
              data-testid="tab-inbox"
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium border-b-2 transition-colors",
                folder === "inbox"
                  ? "border-teal-600 text-teal-700 dark:text-teal-400"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <Inbox className="h-4 w-4" />
              Inbox
              {unread > 0 && (
                <span className="bg-teal-600 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </button>
            <button
              onClick={() => { setFolder("sent"); setSelectedMessage(null); }}
              data-testid="tab-sent"
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium border-b-2 transition-colors",
                folder === "sent"
                  ? "border-teal-600 text-teal-700 dark:text-teal-400"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <Send className="h-4 w-4" />
              Sent
            </button>
          </div>

          {/* Message list */}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Clock className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center px-4">
                <MessageSquare className="h-10 w-10 text-muted-foreground mb-3 opacity-40" />
                <p className="text-sm font-medium text-muted-foreground">
                  {folder === "inbox" ? "Your inbox is empty" : "No sent messages"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {folder === "inbox"
                    ? "Messages from managers will appear here"
                    : "Messages you send will appear here"}
                </p>
              </div>
            ) : (
              messages.map((msg) => (
                <MessageRow
                  key={msg.id}
                  msg={msg}
                  selected={selectedMessage?.id === msg.id}
                  onSelect={() => setSelectedMessage(msg)}
                  timezone={companyTimezone}
                />
              ))
            )}
          </div>
        </div>

        {/* Message detail / thread */}
        <div className={cn(
          "flex-1 overflow-hidden",
          !selectedMessage && "hidden md:flex md:items-center md:justify-center"
        )}>
          {selectedMessage ? (
            <MessageThread
              message={selectedMessage}
              onBack={() => setSelectedMessage(null)}
              timezone={companyTimezone}
            />
          ) : (
            <div className="text-center text-muted-foreground">
              <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <p className="text-sm">Select a message to read</p>
            </div>
          )}
        </div>
      </div>

      <Dialog open={showCompose} onOpenChange={setShowCompose}>
        <ComposeDialog onClose={() => setShowCompose(false)} onSent={() => setShowCompose(false)} />
      </Dialog>
    </div>
  );
}
