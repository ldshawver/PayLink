import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CheckCircle, Clock, AlertCircle, Loader2, Paperclip, Download, XCircle, MessageSquare, Send, Mail, Sparkles, CornerDownLeft, X,
} from "lucide-react";

const fmt = (n: number | string | undefined | null) => {
  const v = parseFloat(String(n || 0));
  return isNaN(v) ? "$0.00" : v.toLocaleString("en-US", { style: "currency", currency: "USD" });
};

const fmtDate = (s?: string | null) => {
  if (!s) return "";
  try { return new Date(s).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }); }
  catch { return s; }
};

const fmtDateTime = (s?: string | null) => {
  if (!s) return "";
  try {
    return new Date(s).toLocaleString("en-US", {
      month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit",
    });
  } catch { return s; }
};

interface ThreadEvent {
  eventType: "client_message" | "admin_reply";
  notes: string | null;
  actorName: string | null;
  createdAt: string;
}

interface ProposalPortalData {
  id: string;
  proposalNumber: string;
  title: string;
  description?: string;
  status: string;
  scopeOfWork?: string;
  assumptions?: string;
  exclusions?: string;
  paymentTerms?: string;
  warrantyNotes?: string;
  clientMessage?: string;
  estimatorName?: string;
  issueDate?: string;
  expirationDate?: string;
  subtotal?: string;
  taxAmount?: string;
  discountAmount?: string;
  amount?: string;
  currency?: string;
  approvalName?: string;
  approvalEmail?: string;
  approvalAt?: string;
  version?: number;
  emailNotifiedAt?: string | null;
  thread?: ThreadEvent[];
  lineItems: Array<{
    id: string; name: string; description?: string; category?: string;
    quantity: string; unit?: string; unitPrice: string; lineTotal: string;
    optional: boolean; selected: boolean;
  }>;
  branding?: {
    businessName?: string; primaryColor?: string; logoUrl?: string;
    tagline?: string; websiteUrl?: string; licenseNumber?: string;
    coverNote?: string; footerText?: string; signatureText?: string;
  };
  contractorName?: string;
  companyName?: string;
}

interface Attachment {
  id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  attachment_type: string | null;
  created_at: string;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
    sent: { label: "Sent", variant: "secondary" },
    viewed: { label: "Viewed", variant: "secondary" },
    approved: { label: "Approved", variant: "default" },
    signed: { label: "Signed", variant: "default" },
    negotiated: { label: "Negotiated", variant: "secondary" },
    countered: { label: "Counter Offer", variant: "outline" },
  };
  const s = map[status] || { label: status, variant: "outline" as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

function ConversationThread({
  thread,
  businessName,
  accentColor,
  lastViewedAt,
  firstUnreadRef,
  proposalId,
  token,
  onReplySent,
}: {
  thread: ThreadEvent[];
  businessName: string;
  accentColor: string;
  lastViewedAt: number | null;
  firstUnreadRef: React.RefObject<HTMLDivElement | null>;
  proposalId: string;
  token: string;
  onReplySent?: () => void;
}) {
  const [replyingToIdx, setReplyingToIdx] = useState<number | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replySubmitting, setReplySubmitting] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replyJustSent, setReplyJustSent] = useState(false);

  const handleReplySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim()) return;
    setReplySubmitting(true);
    setReplyError(null);
    try {
      const r = await fetch(
        `/api/portal/proposals/${proposalId}/message?token=${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: replyText.trim() }),
        },
      );
      if (!r.ok) {
        const d = await r.json();
        setReplyError(d.message || "Could not send reply");
        setReplySubmitting(false);
        return;
      }
      setReplyText("");
      setReplyingToIdx(null);
      setReplyJustSent(true);
      onReplySent?.();
      setTimeout(() => setReplyJustSent(false), 4000);
    } catch {
      setReplyError("Network error — please try again");
    } finally {
      setReplySubmitting(false);
    }
  };

  if (!thread || thread.length === 0) return null;

  let firstUnreadAssigned = false;

  const unreadCount = thread.filter(
    evt =>
      evt.eventType === "admin_reply" &&
      lastViewedAt !== null &&
      new Date(evt.createdAt).getTime() > lastViewedAt,
  ).length;

  return (
    <div data-testid="conversation-thread">
      <h2 className="text-base font-semibold mb-3 pb-1 border-b flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-muted-foreground" />
        Conversation
        {unreadCount > 0 && (
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold text-white"
            style={{ backgroundColor: accentColor }}
            data-testid="unread-count-badge"
          >
            <Sparkles className="h-3 w-3" />
            {unreadCount} new
          </span>
        )}
      </h2>
      {replyJustSent && (
        <div
          className="flex items-center gap-2 text-sm rounded-lg px-3 py-2 mb-3"
          style={{ backgroundColor: accentColor + "15", color: accentColor }}
          data-testid="reply-sent-confirmation"
        >
          <CheckCircle className="h-4 w-4 shrink-0" />
          <span>Reply sent — the team will be in touch soon.</span>
        </div>
      )}
      <div className="space-y-3">
        {thread.map((evt, i) => {
          const isAdminReply = evt.eventType === "admin_reply";
          const isUnread =
            isAdminReply &&
            lastViewedAt !== null &&
            new Date(evt.createdAt).getTime() > lastViewedAt;

          let refProp: React.RefObject<HTMLDivElement | null> | undefined;
          if (isUnread && !firstUnreadAssigned) {
            refProp = firstUnreadRef;
            firstUnreadAssigned = true;
          }

          return (
            <div
              key={i}
              ref={refProp as React.RefObject<HTMLDivElement> | undefined}
              className={`flex flex-col ${isAdminReply ? "items-end" : "items-start"}`}
              data-testid={`thread-event-${i}`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-4 py-3 text-sm shadow-sm ${
                  isAdminReply
                    ? "rounded-br-sm text-white"
                    : "bg-white border rounded-bl-sm text-gray-800"
                } ${isUnread ? "ring-2 ring-offset-1" : ""}`}
                style={
                  isAdminReply
                    ? {
                        backgroundColor: accentColor,
                        ...(isUnread ? { outlineColor: accentColor } : {}),
                      }
                    : {}
                }
              >
                <div className={`text-xs font-semibold mb-1 ${isAdminReply ? "text-white/80" : "text-muted-foreground"} flex items-center gap-1.5`}>
                  {isAdminReply
                    ? `From ${businessName}`
                    : (evt.actorName && evt.actorName !== "Client" ? evt.actorName : "You")}
                  {isUnread && (
                    <span
                      className="rounded-full px-1.5 py-0.5 text-white font-bold leading-none"
                      style={{ fontSize: "9px", backgroundColor: "rgba(255,255,255,0.35)" }}
                      data-testid={`unread-badge-${i}`}
                    >
                      NEW
                    </span>
                  )}
                </div>
                <p className="whitespace-pre-wrap leading-relaxed">{evt.notes || ""}</p>
                <div className={`text-xs mt-1.5 ${isAdminReply ? "text-white/60" : "text-muted-foreground/70"} flex items-center justify-between gap-3`}>
                  <span>{fmtDateTime(evt.createdAt)}</span>
                  {isAdminReply && (
                    <button
                      type="button"
                      onClick={() => {
                        setReplyingToIdx(replyingToIdx === i ? null : i);
                        setReplyText("");
                        setReplyError(null);
                      }}
                      className="flex items-center gap-1 text-white/70 hover:text-white transition-colors"
                      data-testid={`btn-reply-to-admin-${i}`}
                    >
                      <CornerDownLeft className="h-3 w-3" />
                      Reply
                    </button>
                  )}
                </div>
              </div>

              {/* Inline reply compose box */}
              {isAdminReply && replyingToIdx === i && (
                <div
                  className="mt-2 w-full max-w-[80%] rounded-lg border bg-white shadow-sm p-3 space-y-2"
                  data-testid={`inline-reply-box-${i}`}
                >
                  <form onSubmit={handleReplySubmit} className="space-y-2">
                    <Textarea
                      value={replyText}
                      onChange={e => setReplyText(e.target.value)}
                      placeholder="Type your reply…"
                      rows={3}
                      required
                      autoFocus
                      className="resize-none text-sm"
                      data-testid={`textarea-inline-reply-${i}`}
                    />
                    {replyError && (
                      <div className="flex items-center gap-1.5 text-xs text-destructive">
                        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                        <span>{replyError}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs px-2 text-muted-foreground"
                        onClick={() => { setReplyingToIdx(null); setReplyText(""); setReplyError(null); }}
                        data-testid={`btn-cancel-inline-reply-${i}`}
                      >
                        <X className="h-3.5 w-3.5 mr-1" />
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        size="sm"
                        disabled={replySubmitting || !replyText.trim()}
                        className="h-7 text-xs text-white"
                        style={{ backgroundColor: accentColor, borderColor: accentColor }}
                        data-testid={`btn-submit-inline-reply-${i}`}
                      >
                        {replySubmitting
                          ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />Sending…</>
                          : <><Send className="h-3.5 w-3.5 mr-1" />Send Reply</>}
                      </Button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ClientApprovalForm({
  proposalId,
  token,
  onApproved,
}: {
  proposalId: string;
  token: string;
  onApproved: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) { setError("Name and email are required"); return; }
    setSubmitting(true); setError(null);
    try {
      const r = await fetch(
        `/api/portal/proposals/${proposalId}/approve?token=${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ approvalName: name, approvalEmail: email, approvalNotes: notes }),
        },
      );
      if (!r.ok) {
        const d = await r.json();
        setError(d.message || "Could not submit approval");
        setSubmitting(false);
        return;
      }
      onApproved();
    } catch {
      setError("Network error — please try again");
      setSubmitting(false);
    }
  };

  return (
    <Card className="border-2 border-primary/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <CheckCircle className="h-5 w-5 text-primary" /> Approve This Proposal
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          By approving, you confirm you have reviewed this proposal and agree to its terms.
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="portal-approval-name">Your Full Name *</Label>
              <Input
                id="portal-approval-name"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Jane Smith"
                required
                data-testid="input-approval-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="portal-approval-email">Your Email *</Label>
              <Input
                id="portal-approval-email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="jane@example.com"
                required
                data-testid="input-approval-email"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="portal-approval-notes">Notes (optional)</Label>
            <Textarea
              id="portal-approval-notes"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Any comments or conditions..."
              rows={2}
              data-testid="textarea-approval-notes"
            />
          </div>
          {error && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          <Button type="submit" disabled={submitting} className="w-full" data-testid="button-submit-approval">
            {submitting
              ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Submitting...</>
              : <><CheckCircle className="h-4 w-4 mr-2" />Approve Proposal</>}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function ClientMessageForm({
  proposalId,
  token,
  accentColor,
  onSent,
  compact = false,
}: {
  proposalId: string;
  token: string;
  accentColor: string;
  onSent?: () => void;
  compact?: boolean;
}) {
  const [message, setMessage] = useState("");
  const [senderName, setSenderName] = useState("");
  const [senderEmail, setSenderEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [justSent, setJustSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) { setError("Please enter a message"); return; }
    setSubmitting(true); setError(null);
    try {
      const r = await fetch(
        `/api/portal/proposals/${proposalId}/message?token=${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: message.trim(), senderName: senderName.trim() || undefined, senderEmail: senderEmail.trim() || undefined }),
        },
      );
      if (!r.ok) {
        const d = await r.json();
        setError(d.message || "Could not send message");
        setSubmitting(false);
        return;
      }
      setMessage("");
      setJustSent(true);
      onSent?.();
      // Reset the "just sent" notice after 3 s so they can reply again
      setTimeout(() => setJustSent(false), 3000);
    } catch {
      setError("Network error — please try again");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Compact inline reply box (shown below an existing thread) ────────────
  if (compact) {
    return (
      <div className="space-y-2">
        <h2 className="text-base font-semibold pb-1 border-b flex items-center gap-2">
          <Send className="h-4 w-4 text-muted-foreground" />
          Reply
        </h2>
        {justSent && (
          <div className="flex items-center gap-2 text-sm rounded-lg px-3 py-2" style={{ backgroundColor: accentColor + "15", color: accentColor }}>
            <CheckCircle className="h-4 w-4 shrink-0" />
            <span>Reply sent — the team will be in touch soon.</span>
          </div>
        )}
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <Textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder="Type your reply…"
            rows={3}
            required
            data-testid="textarea-reply-text"
            className="resize-none"
          />
          {error && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={submitting || !message.trim()}
              size="sm"
              data-testid="button-send-reply"
              style={{ backgroundColor: accentColor, borderColor: accentColor }}
              className="text-white"
            >
              {submitting
                ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Sending…</>
                : <><Send className="h-4 w-4 mr-2" />Send Reply</>}
            </Button>
          </div>
        </form>
      </div>
    );
  }

  // ── Full card form (shown when there is no thread yet) ───────────────────
  return (
    <div className="space-y-3">
      {justSent && (
        <div className="rounded-lg border-2 p-4 flex items-start gap-3" style={{ borderColor: accentColor + "40", backgroundColor: accentColor + "08" }}>
          <CheckCircle className="h-5 w-5 mt-0.5 shrink-0" style={{ color: accentColor }} />
          <div>
            <p className="text-sm font-semibold" style={{ color: accentColor }}>Message sent</p>
            <p className="text-sm text-muted-foreground">We received your message and will get back to you soon.</p>
          </div>
        </div>
      )}
      <Card className="border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-muted-foreground" /> Send a message
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Have a question or want to request a change? Send a message directly to the team.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="portal-msg-name">Your Name (optional)</Label>
                <Input
                  id="portal-msg-name"
                  value={senderName}
                  onChange={e => setSenderName(e.target.value)}
                  placeholder="Jane Smith"
                  data-testid="input-message-name"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="portal-msg-email">Your Email (optional)</Label>
                <Input
                  id="portal-msg-email"
                  type="email"
                  value={senderEmail}
                  onChange={e => setSenderEmail(e.target.value)}
                  placeholder="jane@example.com"
                  data-testid="input-message-email"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="portal-msg-text">Message *</Label>
              <Textarea
                id="portal-msg-text"
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="Ask a question or describe any changes you'd like..."
                rows={3}
                required
                data-testid="textarea-message-text"
              />
            </div>
            {error && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <Button type="submit" disabled={submitting} variant="outline" className="w-full" data-testid="button-send-message">
              {submitting
                ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Sending...</>
                : <><Send className="h-4 w-4 mr-2" />Send Message</>}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function ProposalPortalPage() {
  const [location] = useLocation();

  // Extract proposal ID and share token from the URL
  // URL pattern: /proposal/:id?token=<shareToken>
  const pathPart = location.split("/proposal/")[1] || "";
  const [pathId, queryStr] = pathPart.split("?");
  const proposalId = pathId || "";
  const params = new URLSearchParams(queryStr || window.location.search);
  const token = params.get("token") || "";

  const [loading, setLoading] = useState(true);
  const [proposal, setProposal] = useState<ProposalPortalData | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [approved, setApproved] = useState(false);

  // Track the timestamp of the client's last visit so we can highlight new admin replies.
  // We read this BEFORE loading data so we capture the "previous" visit time, then
  // update it after data loads so future visits correctly mark only truly new messages.
  const lsKey = proposalId ? `portal_last_viewed_${proposalId}` : null;
  const [lastViewedAt] = useState<number | null>(() => {
    if (!lsKey) return null;
    try {
      const stored = localStorage.getItem(lsKey);
      return stored ? parseInt(stored, 10) : null;
    } catch {
      return null;
    }
  });

  // Ref used to auto-scroll to the first unread admin reply
  const firstUnreadRef = useRef<HTMLDivElement | null>(null);

  // Sentinel ref at the bottom of the thread — used for auto-scroll
  const threadBottomRef = useRef<HTMLDivElement | null>(null);

  function scrollThreadToBottom() {
    setTimeout(() => threadBottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  const loadData = useCallback(async () => {
    if (!proposalId) { setError("Invalid proposal link"); setLoading(false); return; }
    if (!token) {
      setError("This link is missing a required access token. Please use the link provided in your email.");
      setLoading(false);
      return;
    }
    try {
      const encodedToken = encodeURIComponent(token);
      const [propRes, attRes] = await Promise.all([
        fetch(`/api/portal/proposals/${proposalId}?token=${encodedToken}`),
        fetch(`/api/portal/proposals/${proposalId}/attachments?token=${encodedToken}`),
      ]);
      if (!propRes.ok) {
        const d = await propRes.json();
        setError(d.message || "Proposal not available");
        setLoading(false);
        return;
      }
      const propData = await propRes.json();
      setProposal(propData);
      if (attRes.ok) {
        setAttachments(await attRes.json());
      }
      // Record this visit so next time we can detect new replies
      if (lsKey) {
        try { localStorage.setItem(lsKey, String(Date.now())); } catch { /* storage unavailable */ }
      }
    } catch {
      setError("Failed to load proposal — please check the link and try again.");
    }
    setLoading(false);
  }, [proposalId, token, lsKey]);

  useEffect(() => { loadData(); }, [loadData]);

  // On load: scroll to the thread bottom so the latest message is always visible
  useEffect(() => {
    if (!loading) {
      scrollThreadToBottom();
    }
  }, [loading]);

  // Reload proposal data (including thread) after client sends a message, then scroll to bottom
  const handleMessageSent = useCallback(async () => {
    await loadData();
    scrollThreadToBottom();
  }, [loadData]);

  const accentColor = proposal?.branding?.primaryColor || "#0f766e";
  const businessName = proposal?.branding?.businessName || proposal?.companyName || "PayLink";

  const getDownloadUrl = (att: Attachment) =>
    `/api/portal/proposals/${proposalId}/attachments/${att.id}/download?token=${encodeURIComponent(token)}`;

  const subtotal = proposal?.lineItems.reduce((s, li) => s + parseFloat(li.lineTotal || "0"), 0) || 0;
  const tax = parseFloat(proposal?.taxAmount || "0");
  const discount = parseFloat(proposal?.discountAmount || "0");
  const total = subtotal + tax - discount;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 gap-4 p-6 text-center">
        <div className="h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center">
          <XCircle className="h-8 w-8 text-destructive" />
        </div>
        <h1 className="text-xl font-semibold">Proposal Unavailable</h1>
        <p className="text-muted-foreground max-w-sm text-sm">{error}</p>
      </div>
    );
  }

  if (!proposal) return null;

  const canApprove = ["sent", "viewed"].includes(proposal.status) && !approved;
  const isApproved = proposal.status === "approved" || approved;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="h-2" style={{ backgroundColor: accentColor }} />

      <div className="px-4 sm:px-8 py-6 border-b bg-white" style={{ borderColor: accentColor + "30" }}>
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row justify-between items-start gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-lg shrink-0"
                style={{ backgroundColor: accentColor }}
              >
                {businessName.charAt(0).toUpperCase()}
              </div>
              <div>
                <h2 className="font-bold text-lg text-gray-900 leading-tight">{businessName}</h2>
                {proposal.branding?.tagline && (
                  <p className="text-xs text-muted-foreground">{proposal.branding.tagline}</p>
                )}
              </div>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mt-2">{proposal.title || "Proposal"}</h1>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-sm text-muted-foreground">{proposal.proposalNumber}</p>
              <StatusBadge status={proposal.status} />
            </div>
            {proposal.emailNotifiedAt && (
              <div
                className="flex items-center gap-1.5 mt-1.5"
                data-testid="text-email-notification-notice"
              >
                <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <p className="text-xs text-muted-foreground">
                  You were notified by email on {fmtDate(proposal.emailNotifiedAt)}
                </p>
              </div>
            )}
          </div>
          <div className="text-left sm:text-right text-sm text-muted-foreground space-y-0.5 shrink-0">
            {proposal.issueDate && <p>Date: {fmtDate(proposal.issueDate)}</p>}
            {proposal.expirationDate && <p>Expires: {fmtDate(proposal.expirationDate)}</p>}
            {proposal.estimatorName && <p>Prepared by: {proposal.estimatorName}</p>}
            {proposal.branding?.websiteUrl && <p className="text-xs">{proposal.branding.websiteUrl}</p>}
            {proposal.branding?.licenseNumber && <p className="text-xs">Lic. #{proposal.branding.licenseNumber}</p>}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-8 py-8 space-y-8">

        {(proposal.branding?.coverNote || proposal.clientMessage) && (
          <div
            className="rounded-lg p-4 italic text-sm text-muted-foreground border-l-4"
            style={{ borderColor: accentColor, backgroundColor: accentColor + "10" }}
          >
            "{proposal.branding?.coverNote || proposal.clientMessage}"
          </div>
        )}

        {proposal.scopeOfWork && (
          <div>
            <h2 className="text-base font-semibold mb-2 pb-1 border-b">Scope of Work</h2>
            <p className="text-sm whitespace-pre-wrap text-gray-700">{proposal.scopeOfWork}</p>
          </div>
        )}

        {proposal.lineItems.length > 0 && (
          <div>
            <h2 className="text-base font-semibold mb-3 pb-1 border-b">Pricing</h2>
            <div className="overflow-x-auto -mx-1 px-1">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-muted-foreground border-b">
                  <th className="text-left py-1 font-medium">Item</th>
                  <th className="text-right py-1 font-medium">Qty</th>
                  <th className="text-right py-1 font-medium">Unit Price</th>
                  <th className="text-right py-1 font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {proposal.lineItems.map(item => (
                  <tr key={item.id}>
                    <td className="py-1.5">
                      <p className="font-medium">{item.name}{item.optional ? " (Optional)" : ""}</p>
                      {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
                    </td>
                    <td className="text-right py-1.5">{item.quantity}</td>
                    <td className="text-right py-1.5">{fmt(item.unitPrice)}</td>
                    <td className="text-right py-1.5 font-medium">{fmt(item.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            <div className="mt-3 border-t pt-3 space-y-1 text-sm max-w-xs ml-auto">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span><span>{fmt(subtotal)}</span>
              </div>
              {tax > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tax</span><span>{fmt(tax)}</span>
                </div>
              )}
              {discount > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Discount</span><span>-{fmt(discount)}</span>
                </div>
              )}
              <div className="flex justify-between font-semibold border-t pt-1">
                <span>Total</span>
                <span style={{ color: accentColor }}>{fmt(total || parseFloat(proposal.amount || "0"))}</span>
              </div>
            </div>
          </div>
        )}

        {proposal.assumptions && (
          <div>
            <h2 className="text-base font-semibold mb-2 pb-1 border-b">Assumptions</h2>
            <p className="text-sm whitespace-pre-wrap text-gray-700">{proposal.assumptions}</p>
          </div>
        )}
        {proposal.exclusions && (
          <div>
            <h2 className="text-base font-semibold mb-2 pb-1 border-b">Exclusions</h2>
            <p className="text-sm whitespace-pre-wrap text-gray-700">{proposal.exclusions}</p>
          </div>
        )}
        {proposal.paymentTerms && (
          <div>
            <h2 className="text-base font-semibold mb-2 pb-1 border-b">Payment Terms</h2>
            <p className="text-sm whitespace-pre-wrap text-gray-700">{proposal.paymentTerms}</p>
          </div>
        )}
        {proposal.warrantyNotes && (
          <div>
            <h2 className="text-base font-semibold mb-2 pb-1 border-b">Warranty</h2>
            <p className="text-sm whitespace-pre-wrap text-gray-700">{proposal.warrantyNotes}</p>
          </div>
        )}

        {attachments.length > 0 && (
          <div>
            <h2 className="text-base font-semibold mb-3 pb-1 border-b">Attachments</h2>
            <div className="space-y-3">
              {attachments.map(att => {
                const isImage = /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(att.file_name || "");
                const href = getDownloadUrl(att);
                return (
                  <div key={att.id}>
                    {isImage ? (
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-muted-foreground">
                          {att.file_name}
                          {att.attachment_type ? ` — ${att.attachment_type.replace(/_/g, " ")}` : ""}
                        </p>
                        <img
                          src={href}
                          alt={att.file_name}
                          className="max-w-full max-h-64 rounded border object-contain bg-white"
                          data-testid={`portal-attachment-img-${att.id}`}
                        />
                        <a
                          href={href}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                          data-testid={`portal-attachment-dl-${att.id}`}
                        >
                          <Download className="h-3 w-3" /> Download
                        </a>
                      </div>
                    ) : (
                      <a
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-2 p-2.5 rounded border hover:bg-gray-50 transition-colors group bg-white"
                        data-testid={`portal-attachment-link-${att.id}`}
                      >
                        <Paperclip className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{att.file_name}</p>
                          {att.attachment_type && (
                            <p className="text-xs text-muted-foreground capitalize">
                              {att.attachment_type.replace(/_/g, " ")}
                            </p>
                          )}
                        </div>
                        <Download className="h-4 w-4 text-muted-foreground shrink-0" />
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Conversation thread + reply box — kept together so the UI feels like one chat pane */}
        {proposal.thread && proposal.thread.length > 0 ? (
          <div className="space-y-6">
            <ConversationThread
              thread={proposal.thread}
              businessName={businessName}
              accentColor={accentColor}
              lastViewedAt={lastViewedAt}
              firstUnreadRef={firstUnreadRef}
              proposalId={proposal.id}
              token={token}
              onReplySent={handleMessageSent}
            />
            {/* Compact reply box rendered directly below the thread */}
            <ClientMessageForm
              proposalId={proposal.id}
              token={token}
              accentColor={accentColor}
              onSent={handleMessageSent}
              compact
            />
            <div ref={threadBottomRef} />
          </div>
        ) : (
          /* No thread yet — show the full "Send a message" card */
          <>
            <ClientMessageForm
              proposalId={proposal.id}
              token={token}
              accentColor={accentColor}
              onSent={handleMessageSent}
            />
            <div ref={threadBottomRef} />
          </>
        )}

        {isApproved && (
          <div className="border-2 border-green-500 rounded-lg p-4 bg-green-50">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              <h2 className="font-semibold text-green-700">Proposal Approved</h2>
            </div>
            <p className="text-sm text-green-700">
              {proposal.approvalName
                ? <>Approved by <strong>{proposal.approvalName}</strong> ({proposal.approvalEmail})</>
                : "Thank you — your approval has been recorded."}
            </p>
            {proposal.approvalAt && (
              <p className="text-xs text-green-600 mt-1">{fmtDate(proposal.approvalAt)}</p>
            )}
          </div>
        )}

        {canApprove && (
          <ClientApprovalForm
            proposalId={proposal.id}
            token={token}
            onApproved={() => setApproved(true)}
          />
        )}

        {!canApprove && !isApproved && (
          <div className="flex items-center gap-2 p-3 rounded-lg border bg-white text-sm text-muted-foreground">
            <Clock className="h-4 w-4 shrink-0" />
            <span>
              This proposal is in <strong>{proposal.status}</strong> status and cannot be approved at this time.
            </span>
          </div>
        )}

        {proposal.branding?.signatureText && (
          <div className="mt-4 pt-4 border-t">
            <p className="text-sm font-medium text-gray-700">{proposal.branding.signatureText}</p>
            {businessName && <p className="text-xs text-muted-foreground mt-0.5">{businessName}</p>}
          </div>
        )}

        <div className="text-center pt-4 border-t">
          <p className="text-xs text-muted-foreground">
            Powered by <strong>PayLink</strong> — Secure Proposal Portal
          </p>
        </div>
      </div>

      {(proposal.branding?.footerText || businessName) && (
        <div
          className="px-8 py-4 border-t text-center"
          style={{ borderColor: accentColor + "30", backgroundColor: accentColor + "08" }}
        >
          <p className="text-xs text-muted-foreground">
            {proposal.branding?.footerText || businessName}
          </p>
        </div>
      )}
      <div className="h-2" style={{ backgroundColor: accentColor }} />
    </div>
  );
}
