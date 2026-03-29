export type DealStage = "lead" | "qualified" | "proposal" | "negotiation" | "closed_won" | "closed_lost";

export interface Deal {
  id: number;
  companyId: string;
  customerId: string;
  customerName: string;
  title: string;
  value: number;
  stage: DealStage;
  product: string;
  assignedTo: string;
  notes: string | null;
  expectedCloseDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InsertDeal {
  customerId: string;
  title: string;
  value: number;
  stage: DealStage;
  product: string;
  assignedTo: string;
  notes?: string | null;
  expectedCloseDate?: string | null;
}

export type OnboardingProjectStatus = "not_started" | "in_progress" | "completed" | "on_hold" | "cancelled";

export interface OnboardingProject {
  id: number;
  companyId: string;
  customerId: string;
  customerName: string;
  dealId: number | null;
  templateId: number | null;
  title: string;
  product: string;
  status: OnboardingProjectStatus;
  assignedTo: string;
  progress: number;
  startDate: string | null;
  targetDate: string | null;
  completedDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InsertOnboardingProject {
  customerId: string;
  dealId?: number | null;
  templateId?: number | null;
  title: string;
  product: string;
  status?: OnboardingProjectStatus;
  assignedTo: string;
  startDate?: string | null;
  targetDate?: string | null;
}

export interface OnboardingTask {
  id: number;
  projectId: number;
  title: string;
  description: string | null;
  completed: boolean;
  order: number;
  dueDate: string | null;
  assignedTo: string | null;
  completedAt: string | null;
  category: string;
}

export interface InsertOnboardingTask {
  projectId: number;
  title: string;
  description?: string | null;
  order: number;
  dueDate?: string | null;
  assignedTo?: string | null;
  category?: string;
}

export interface OnboardingTemplate {
  id: number;
  companyId: string;
  name: string;
  product: string;
  description: string | null;
  tasks: TemplateTask[];
  trainingResources: TemplateResource[];
  documentLinks: TemplateResource[];
  createdAt: string;
  updatedAt: string;
}

export interface TemplateTask {
  title: string;
  description: string;
  category: string;
  order: number;
}

export interface TemplateResource {
  title: string;
  url: string;
  type: string;
}

export interface InsertOnboardingTemplate {
  name: string;
  product: string;
  description?: string | null;
  tasks: TemplateTask[];
  trainingResources?: TemplateResource[];
  documentLinks?: TemplateResource[];
}

export type EngagementEventType = "email" | "call" | "meeting" | "note" | "login" | "task_completed" | "document_signed" | "payment" | "support_ticket" | "feature_activated";

export interface EngagementEvent {
  id: number;
  companyId: string;
  customerId: string;
  customerName: string;
  projectId: number | null;
  eventType: EngagementEventType;
  title: string;
  description: string | null;
  product: string | null;
  metadata: Record<string, any> | null;
  createdAt: string;
}

export const DEAL_STAGES: { value: DealStage; label: string; color: string }[] = [
  { value: "lead", label: "Lead", color: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300" },
  { value: "qualified", label: "Qualified", color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400" },
  { value: "proposal", label: "Proposal", color: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400" },
  { value: "negotiation", label: "Negotiation", color: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400" },
  { value: "closed_won", label: "Closed Won", color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400" },
  { value: "closed_lost", label: "Closed Lost", color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" },
];

export const PROJECT_STATUSES: { value: OnboardingProjectStatus; label: string; color: string }[] = [
  { value: "not_started", label: "Not Started", color: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300" },
  { value: "in_progress", label: "In Progress", color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400" },
  { value: "completed", label: "Completed", color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400" },
  { value: "on_hold", label: "On Hold", color: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400" },
  { value: "cancelled", label: "Cancelled", color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" },
];

export const EVENT_TYPES: { value: EngagementEventType; label: string }[] = [
  { value: "email", label: "Email" },
  { value: "call", label: "Call" },
  { value: "meeting", label: "Meeting" },
  { value: "note", label: "Note" },
  { value: "login", label: "Login" },
  { value: "task_completed", label: "Task Completed" },
  { value: "document_signed", label: "Document Signed" },
  { value: "payment", label: "Payment" },
  { value: "support_ticket", label: "Support Ticket" },
  { value: "feature_activated", label: "Feature Activated" },
];

export const PRODUCTS = [
  "MyPayLink",
  "PayLink HR",
  "PayLink Payroll",
  "PayLink Time",
  "PayLink Schedule",
];
