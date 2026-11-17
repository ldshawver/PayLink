/**
 * Applicant portal — the ONLY screen a limited `applicant` account sees.
 *
 * Applicants are not workers: no sidebar, no dashboard, no Contractor Hub,
 * payroll, schedules or documents. The server confines the role to its own
 * job-board API allowlist; this page renders the shared Jobs worker view
 * (Available Opportunities + My Applications; never My Proposals).
 */
import { Briefcase, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { JobBoardSection } from "@/components/contractor-hub/job-board";

export default function ApplicantPortalPage() {
  const { user, logout } = useAuth();
  return (
    <div className="min-h-screen bg-background" data-testid="page-applicant-portal">
      <header className="border-b">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-2">
          <Briefcase className="h-5 w-5 text-primary" />
          <p className="font-semibold">My job applications</p>
          <span className="text-xs text-muted-foreground ml-2 hidden sm:inline">{user?.username}</span>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => { void logout().finally(() => window.location.assign("/login")); }} data-testid="btn-applicant-logout">
            <LogOut className="h-4 w-4 mr-1" />Sign out
          </Button>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6">
        <JobBoardSection user={user} onNavigate={() => undefined} />
      </main>
    </div>
  );
}
