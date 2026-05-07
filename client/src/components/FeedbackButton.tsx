import { useState } from "react";
import { useLocation } from "wouter";
import { MessageSquarePlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";

const TYPE_OPTIONS = [
  { value: "bug", label: "Bug Report" },
  { value: "ux", label: "UX Issue" },
  { value: "feature", label: "Feature Request" },
  { value: "general", label: "General Feedback" },
];
const SEVERITY_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];

export function FeedbackButton() {
  const { user } = useAuth();
  const [location] = useLocation();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [type, setType] = useState("bug");
  const [severity, setSeverity] = useState("medium");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [screenshot, setScreenshot] = useState<File | null>(null);

  // Hide on the auth/landing pages — only show when there is a logged-in user.
  if (!user) return null;

  const reset = () => {
    setType("bug");
    setSeverity("medium");
    setTitle("");
    setDescription("");
    setScreenshot(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !description.trim()) {
      toast({ title: "Missing info", description: "Please fill in title and description.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("type", type);
      fd.append("severity", severity);
      fd.append("title", title.trim());
      fd.append("description", description.trim());
      fd.append("pageUrl", typeof window !== "undefined" ? window.location.href : location);
      if (screenshot) fd.append("screenshot", screenshot);
      const r = await fetch("/api/feedback", { method: "POST", body: fd, credentials: "include" });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.message || `Request failed (${r.status})`);
      }
      toast({ title: "Thanks!", description: "Your feedback was submitted." });
      reset();
      setOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: "Submission failed", description: msg, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="button-feedback-open"
        className="fixed bottom-4 right-4 z-50 shadow-lg rounded-full h-12 w-12 p-0 sm:h-auto sm:w-auto sm:px-4 sm:py-2 sm:rounded-full bg-gradient-to-br from-teal-600 to-blue-600 hover:from-teal-700 hover:to-blue-700 text-white"
        aria-label="Send feedback"
      >
        <MessageSquarePlus className="h-5 w-5 sm:mr-2" />
        <span className="hidden sm:inline">Feedback</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Send Feedback</DialogTitle>
            <DialogDescription>
              Report a bug, suggest an improvement, or share general feedback.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="feedback-type">Type</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger id="feedback-type" data-testid="select-feedback-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TYPE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value} data-testid={`option-feedback-type-${o.value}`}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="feedback-severity">Severity</Label>
                <Select value={severity} onValueChange={setSeverity}>
                  <SelectTrigger id="feedback-severity" data-testid="select-feedback-severity">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SEVERITY_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value} data-testid={`option-feedback-severity-${o.value}`}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="feedback-title">Title</Label>
              <Input
                id="feedback-title"
                data-testid="input-feedback-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Short summary"
                maxLength={200}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="feedback-description">Description</Label>
              <Textarea
                id="feedback-description"
                data-testid="input-feedback-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What happened? Steps to reproduce, expected behavior, etc."
                rows={5}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="feedback-screenshot">Screenshot (optional)</Label>
              <Input
                id="feedback-screenshot"
                data-testid="input-feedback-screenshot"
                type="file"
                accept="image/*"
                onChange={(e) => setScreenshot(e.target.files?.[0] ?? null)}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
                disabled={submitting}
                data-testid="button-feedback-cancel"
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting} data-testid="button-feedback-submit">
                {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Submit
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
