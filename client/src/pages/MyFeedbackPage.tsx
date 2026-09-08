import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, MessageSquare, ChevronDown, ChevronUp, PlusCircle } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";

interface Ticket {
  id: string; type: string; severity: string; status: string; priority_fix: boolean;
  title: string; description: string; page_url: string | null; error_code: string | null;
  steps_to_reproduce: string | null; expected_behavior: string | null; actual_behavior: string | null;
  screenshot_path: string | null; screenshot_paths: string[] | null;
  created_at: string; updated_at: string;
}

interface Comment {
  id: string; author_name: string | null; body: string; is_internal: boolean; created_at: string;
}

const STATUS_BADGE: Record<string, string> = {
  new: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
  reviewed: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
  priority_fix: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
  in_progress: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  waiting_on_user: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200",
  closed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  rejected: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

const STATUS_LABEL: Record<string, string> = {
  new: "New", reviewed: "Reviewed", priority_fix: "Priority Fix",
  in_progress: "In Progress", waiting_on_user: "Waiting on Us",
  closed: "Closed / Resolved", rejected: "Rejected",
};

const TYPE_ICON: Record<string, string> = {
  bug: "🐛", ux: "✨", feature: "💡", change_request: "🔄", hr: "🛡️", general: "💬",
};

export default function MyFeedbackPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [commentBody, setCommentBody] = useState<Record<string, string>>({});

  const { data: tickets = [], isLoading } = useQuery<Ticket[]>({
    queryKey: ["/api/feedback/mine"],
    queryFn: async () => {
      const r = await fetch("/api/feedback/mine", { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
  });

  const { data: expandedComments = [], isLoading: commentsLoading } = useQuery<Comment[]>({
    queryKey: ["/api/feedback", expandedId, "comments"],
    enabled: !!expandedId,
    queryFn: async () => {
      const r = await fetch(`/api/feedback/${expandedId}/comments`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
  });

  const addCommentMutation = useMutation({
    mutationFn: ({ ticketId, body }: { ticketId: string; body: string }) =>
      apiRequest("POST", `/api/feedback/${ticketId}/comments`, { body, isInternal: false }),
    onSuccess: (_, { ticketId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/feedback", ticketId, "comments"] });
      setCommentBody(prev => ({ ...prev, [ticketId]: "" }));
      toast({ title: "Comment added" });
    },
    onError: () => toast({ title: "Failed to add comment", variant: "destructive" }),
  });

  if (!user) return null;

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-my-feedback-title">My Submissions</h1>
        <p className="text-sm text-muted-foreground">Track the status, outcome, and reviewer updates for your feedback and workplace concerns.</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : tickets.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <MessageSquare className="h-8 w-8 mx-auto mb-3 opacity-30" />
            <p>You haven't submitted any feedback yet.</p>
            <p className="text-sm mt-1">Use the <strong>Feedback</strong> button in the bottom-left corner to submit a report.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {tickets.map(t => {
            const isExpanded = expandedId === t.id;
            const comments = isExpanded ? expandedComments : [];
            const allScreenshots = [
              ...(t.screenshot_paths ?? []),
              ...(t.screenshot_path && !(t.screenshot_paths ?? []).includes(t.screenshot_path) ? [t.screenshot_path] : []),
            ].filter(Boolean);

            return (
              <Card key={t.id} data-testid={`card-my-feedback-${t.id}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="text-lg leading-none">{TYPE_ICON[t.type] ?? "💬"}</span>
                      <div className="min-w-0">
                        <p className="font-semibold text-sm truncate" data-testid={`text-my-feedback-title-${t.id}`}>{t.title}</p>
                        <p className="text-xs text-muted-foreground">{new Date(t.created_at).toLocaleString()}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGE[t.status] ?? ""}`}>
                        {STATUS_LABEL[t.status] ?? t.status}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        onClick={() => setExpandedId(isExpanded ? null : t.id)}
                        data-testid={`button-expand-feedback-${t.id}`}
                      >
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                {isExpanded && (
                  <CardContent className="pt-0 space-y-4 border-t mt-2">
                    <div className="flex flex-wrap gap-2 pt-3">
                      <Badge variant="outline" className="capitalize">{t.type.replace("_", " ")}</Badge>
                      <Badge variant="outline" className="capitalize">{t.severity}</Badge>
                      {t.priority_fix && <Badge className="bg-rose-100 text-rose-800 border-rose-200">⭐ Priority Fix</Badge>}
                    </div>

                    <div>
                      <Label className="text-xs uppercase text-muted-foreground">Description</Label>
                      <p className="text-sm whitespace-pre-wrap mt-1">{t.description}</p>
                    </div>

                    {t.error_code && (
                      <div>
                        <Label className="text-xs uppercase text-muted-foreground">Error Code / Message</Label>
                        <code className="block text-sm bg-muted px-2 py-1 rounded mt-1 font-mono">{t.error_code}</code>
                      </div>
                    )}

                    {t.steps_to_reproduce && (
                      <div>
                        <Label className="text-xs uppercase text-muted-foreground">Steps to Reproduce</Label>
                        <p className="text-sm whitespace-pre-wrap mt-1">{t.steps_to_reproduce}</p>
                      </div>
                    )}

                    {(t.expected_behavior || t.actual_behavior) && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {t.expected_behavior && (
                          <div>
                            <Label className="text-xs uppercase text-muted-foreground">Expected</Label>
                            <p className="text-sm whitespace-pre-wrap mt-1">{t.expected_behavior}</p>
                          </div>
                        )}
                        {t.actual_behavior && (
                          <div>
                            <Label className="text-xs uppercase text-muted-foreground">Actual</Label>
                            <p className="text-sm whitespace-pre-wrap mt-1">{t.actual_behavior}</p>
                          </div>
                        )}
                      </div>
                    )}

                    {allScreenshots.length > 0 && (
                      <div>
                        <Label className="text-xs uppercase text-muted-foreground">Screenshots</Label>
                        <div className="flex flex-wrap gap-2 mt-1">
                          {allScreenshots.map((s, i) => (
                            <a key={i} href={s} target="_blank" rel="noreferrer">
                              <img src={s} alt={`Screenshot ${i + 1}`} className="h-20 rounded border object-cover hover:opacity-80 transition-opacity" data-testid={`img-my-screenshot-${t.id}-${i}`} />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    {t.page_url && (
                      <p className="text-xs text-muted-foreground">📍 Submitted from: <span className="font-mono">{t.page_url}</span></p>
                    )}

                    {/* Comments */}
                    <div className="border-t pt-3 space-y-3">
                      <Label className="text-xs uppercase text-muted-foreground flex items-center gap-1.5">
                        <MessageSquare className="h-3.5 w-3.5" /> Updates &amp; Comments
                      </Label>

                      {isExpanded && commentsLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : comments.filter((c: Comment) => !c.is_internal).length === 0 ? (
                        <p className="text-xs text-muted-foreground">No updates yet.</p>
                      ) : (
                        <div className="space-y-2">
                          {comments.filter((c: Comment) => !c.is_internal).map((c: Comment) => (
                            <div key={c.id} className="text-sm p-2 rounded border bg-muted/30" data-testid={`comment-my-${c.id}`}>
                              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                                <span>{c.author_name || "Team"}</span>
                                <span>{new Date(c.created_at).toLocaleString()}</span>
                              </div>
                              <p className="whitespace-pre-wrap">{c.body}</p>
                            </div>
                          ))}
                        </div>
                      )}

                      {t.status !== "closed" && t.status !== "rejected" && (
                        <div className="space-y-2">
                          <Textarea
                            placeholder="Add a comment or provide more details…"
                            value={commentBody[t.id] ?? ""}
                            onChange={e => setCommentBody(prev => ({ ...prev, [t.id]: e.target.value }))}
                            rows={2}
                            data-testid={`input-my-comment-${t.id}`}
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              const body = (commentBody[t.id] ?? "").trim();
                              if (body) addCommentMutation.mutate({ ticketId: t.id, body });
                            }}
                            disabled={addCommentMutation.isPending || !(commentBody[t.id] ?? "").trim()}
                            data-testid={`button-add-comment-${t.id}`}
                          >
                            <PlusCircle className="h-3.5 w-3.5 mr-1.5" /> Add Comment
                          </Button>
                        </div>
                      )}
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
