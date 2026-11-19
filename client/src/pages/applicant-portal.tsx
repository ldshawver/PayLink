/**
 * Applicant portal — the ONLY screen a limited `applicant` account sees.
 *
 * Applicants are not workers: no sidebar, no dashboard, no Contractor Hub,
 * payroll, schedules or documents. The server confines the role to its own
 * job-board API allowlist (server/job-board/applicant-api-allowlist.ts); this
 * page renders the shared Jobs worker view (Available Opportunities + My
 * Applications; never My Proposals) and, at /app/my-feedback, the applicant's
 * OWN feedback submissions — the same view every other role uses. The shared
 * FeedbackButton sits fixed at the bottom-right.
 */
import { Briefcase, LogOut, MessageSquare } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { JobBoardSection } from "@/components/contractor-hub/job-board";
import { FeedbackButton } from "@/components/FeedbackButton";
import MyFeedbackPage from "@/pages/MyFeedbackPage";

const FEEDBACK_PATH = "/app/my-feedback";

export default function ApplicantPortalPage() {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const showFeedback = location === FEEDBACK_PATH;
  return (
    <div className="min-h-screen bg-background" data-testid="page-applicant-portal">
      <header className="border-b">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-2">
          <Briefcase className="h-5 w-5 text-primary" />
          <p className="font-semibold">{showFeedback ? "My feedback" : "My job applications"}</p>
          <span className="text-xs text-muted-foreground ml-2 hidden sm:inline">{user?.username}</span>
          <nav className="ml-auto flex items-center gap-1" aria-label="Applicant portal">
            {showFeedback ? (
              <Button variant="ghost" size="sm" onClick={() => setLocation("/app")} data-testid="btn-applicant-nav-applications">
                <Briefcase className="h-4 w-4 sm:mr-1" aria-hidden="true" /><span className="hidden sm:inline">Applications</span><span className="sr-only sm:hidden">Applications</span>
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setLocation(FEEDBACK_PATH)} data-testid="btn-applicant-nav-feedback">
                <MessageSquare className="h-4 w-4 sm:mr-1" aria-hidden="true" /><span className="hidden sm:inline">My feedback</span><span className="sr-only sm:hidden">My feedback</span>
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => { void logout().finally(() => window.location.assign("/login")); }} data-testid="btn-applicant-logout">
              <LogOut className="h-4 w-4 mr-1" />Sign out
            </Button>
          </nav>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6 pb-[calc(5rem+env(safe-area-inset-bottom))]">
        {showFeedback ? <MyFeedbackPage /> : <JobBoardSection user={user} onNavigate={() => undefined} />}
      </main>
      <FeedbackButton />
    </div>
  );
}
