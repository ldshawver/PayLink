import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Settings as SettingsIcon,
  Shield,
  Bell,
  Database,
  Globe,
  Clock,
} from "lucide-react";

const settingsSections = [
  {
    title: "Overtime & Compliance",
    description: "Configure FLSA overtime rules, minimum wage thresholds, and worker classification settings.",
    icon: Clock,
    status: "Active",
  },
  {
    title: "Break Policies",
    description: "Set up state-specific meal and rest break rules. Supports California and other state requirements.",
    icon: Shield,
    status: "Active",
  },
  {
    title: "Time Rounding",
    description: "Configure rounding increments (5, 6, or 15 minutes) with the 7-minute quarter-hour rule.",
    icon: Clock,
    status: "Active",
  },
  {
    title: "Notifications",
    description: "Manage alerts for missed punches, overtime warnings, timesheet approvals, and filing deadlines.",
    icon: Bell,
    status: "Coming Soon",
  },
  {
    title: "Data Retention",
    description: "Payroll records retained 3 years, time cards 2 years per FLSA requirements.",
    icon: Database,
    status: "Active",
  },
  {
    title: "Tax Configuration",
    description: "FICA, FUTA, state unemployment tax setup. 501(c)(3) FUTA exemptions automatically applied.",
    icon: Globe,
    status: "Coming Soon",
  },
];

export default function SettingsPage() {
  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-settings-title">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure compliance rules, policies, and system preferences.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {settingsSections.map((section) => (
          <Card key={section.title} className="hover-elevate" data-testid={`card-setting-${section.title.toLowerCase().replace(/\s/g, "-")}`}>
            <CardContent className="p-5">
              <div className="flex items-start gap-3">
                <div className="rounded-md bg-primary/10 p-2.5 shrink-0">
                  <section.icon className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-semibold">{section.title}</h3>
                    <Badge
                      variant={section.status === "Active" ? "default" : "secondary"}
                      className="text-xs"
                    >
                      {section.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    {section.description}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <SettingsIcon className="h-4 w-4" /> VPS Deployment Guide
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm space-y-3 text-muted-foreground leading-relaxed">
            <p>
              To deploy PayLink to your VPS via GitHub:
            </p>
            <ol className="list-decimal list-inside space-y-2 pl-2">
              <li>Push this Replit project to a GitHub repository using the Git pane.</li>
              <li>SSH into your VPS and clone the repository.</li>
              <li>Install Node.js 20+ and PostgreSQL on the VPS.</li>
              <li>Set environment variables: <code className="text-xs bg-muted px-1 py-0.5 rounded">DATABASE_URL</code>, <code className="text-xs bg-muted px-1 py-0.5 rounded">SESSION_SECRET</code>, <code className="text-xs bg-muted px-1 py-0.5 rounded">PORT</code>.</li>
              <li>Run <code className="text-xs bg-muted px-1 py-0.5 rounded">npm install</code> then <code className="text-xs bg-muted px-1 py-0.5 rounded">npm run build</code>.</li>
              <li>Push the database schema: <code className="text-xs bg-muted px-1 py-0.5 rounded">npm run db:push</code>.</li>
              <li>Start with <code className="text-xs bg-muted px-1 py-0.5 rounded">NODE_ENV=production node dist/index.js</code>.</li>
              <li>Use NGINX as reverse proxy with SSL (Let's Encrypt) and PM2 for process management.</li>
            </ol>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
