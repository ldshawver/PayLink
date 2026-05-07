/**
 * Feedback & Bug Reporting module — REST routes.
 *
 * Tables (created in server/index.ts):
 *   feedback_tickets, feedback_ticket_comments
 *
 * Authorization model
 *   - All routes require an authenticated session.
 *   - Regular users (and contractors) can only see/comment on their own
 *     submissions.
 *   - Tenant admins/managers (role startsWith "tenant_" OR legacy
 *     "admin"/"manager") can see all tickets within their company.
 *   - Platform admins (role startsWith "platform_") can see every
 *     ticket across every tenant.
 *   - Status changes, ticket assignment, priority-fix flagging, and
 *     internal-only comments are admin-only.
 *
 * Notifications
 *   - On submit: in-app notification to each company admin/manager,
 *     plus an email via sendGenericNotificationEmail (best-effort).
 *   - On status change: in-app notification + email to the submitter.
 *   Both paths use the existing notifications table and the generic
 *   notification email helper — no new template plumbing.
 */
import type { Express, Request, Response } from "express";
import multer from "multer";
import path from "path";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { sendGenericNotificationEmail } from "./notifications";

const ALLOWED_TYPES = new Set(["bug", "ux", "feature", "general"]);
const ALLOWED_SEVERITIES = new Set(["low", "medium", "high", "critical"]);
const ALLOWED_STATUSES = new Set([
  "new",
  "reviewed",
  "priority_fix",
  "in_progress",
  "waiting_on_user",
  "closed",
  "rejected",
]);

interface SessionRequest extends Request {
  session: Request["session"] & { userId?: string };
  file?: Express.Multer.File;
}

interface FeedbackTicketRow {
  id: string;
  company_id: string | null;
  submitter_user_id: string;
  submitter_name: string | null;
  submitter_email: string | null;
  type: string;
  severity: string;
  status: string;
  priority_fix: boolean | null;
  assigned_user_id: string | null;
  title: string;
  description: string;
  page_url: string | null;
  browser_info: string | null;
  screenshot_path: string | null;
  created_at: string;
  updated_at: string;
}

interface FeedbackCommentRow {
  id: string;
  ticket_id: string;
  author_user_id: string;
  author_name: string | null;
  body: string;
  is_internal: boolean | null;
  created_at: string;
}

function firstRow<T>(r: unknown): T | undefined {
  if (Array.isArray(r)) return r[0] as T | undefined;
  const rows = (r as { rows?: unknown[] })?.rows;
  return Array.isArray(rows) ? (rows[0] as T | undefined) : undefined;
}

function allRows<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  const rows = (r as { rows?: unknown[] })?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

function isPlatformRole(role: string | undefined | null): boolean {
  return !!role && role.startsWith("platform_");
}

function isAdminRole(role: string | undefined | null): boolean {
  if (!role) return false;
  return (
    role === "admin" ||
    role === "manager" ||
    role.startsWith("tenant_") ||
    role.startsWith("platform_")
  );
}

function buildBrowserInfo(req: Request): string {
  return JSON.stringify({
    userAgent: req.headers["user-agent"] || null,
    acceptLanguage: req.headers["accept-language"] || null,
    referer: req.headers["referer"] || null,
    capturedAt: new Date().toISOString(),
  });
}

function getAppBaseUrl(req: Request): string {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL;
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost:5000";
  return `${proto}://${host}`;
}

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  reviewed: "Reviewed",
  priority_fix: "Priority Fix",
  in_progress: "In Progress",
  waiting_on_user: "Waiting on User",
  closed: "Closed",
  rejected: "Rejected",
};

export function registerFeedbackRoutes(
  app: Express,
  requireAuth: (req: Request, res: Response, next: () => void) => void,
  upload: multer.Multer,
): void {
  // POST /api/feedback — create a new ticket (any authenticated user)
  app.post(
    "/api/feedback",
    requireAuth,
    upload.single("screenshot"),
    async (req: SessionRequest, res: Response) => {
      try {
        const userId = req.session.userId!;
        const user = await storage.getUser(userId);
        if (!user) return res.status(401).json({ message: "User not found" });

        const { type, severity, title, description, pageUrl } = req.body as Record<string, string>;
        if (!type || !ALLOWED_TYPES.has(type)) {
          return res.status(400).json({ message: "Invalid type. Must be bug, ux, feature, or general." });
        }
        const sev = severity || "medium";
        if (!ALLOWED_SEVERITIES.has(sev)) {
          return res.status(400).json({ message: "Invalid severity." });
        }
        if (!title || !title.trim()) return res.status(400).json({ message: "Title is required" });
        if (!description || !description.trim()) {
          return res.status(400).json({ message: "Description is required" });
        }

        const screenshotPath = req.file ? `/uploads/${req.file.filename}` : null;
        const submitterName =
          [(user as any).firstName, (user as any).lastName].filter(Boolean).join(" ") ||
          (user as any).username ||
          "User";
        const submitterEmail = (user as any).email ?? null;
        const browserInfo = buildBrowserInfo(req);

        const inserted = await db.execute(sql`
          INSERT INTO feedback_tickets (
            company_id, submitter_user_id, submitter_name, submitter_email,
            type, severity, status, title, description, page_url, browser_info, screenshot_path
          ) VALUES (
            ${user.companyId ?? null}, ${userId}, ${submitterName}, ${submitterEmail},
            ${type}, ${sev}, 'new', ${title.trim()}, ${description.trim()},
            ${pageUrl ?? null}, ${browserInfo}, ${screenshotPath}
          )
          RETURNING *
        `);
        const ticket = firstRow<FeedbackTicketRow>(inserted);
        if (!ticket) return res.status(500).json({ message: "Failed to create ticket" });

        // Notify company admins (in-app + email, best-effort).
        try {
          if (user.companyId) {
            const admins = await db.execute(sql`
              SELECT u.id, u.email, u.username
              FROM users u
              WHERE u.company_id = ${user.companyId}
                AND u.role IN ('admin','manager','tenant_admin','tenant_owner','tenant_manager')
              LIMIT 25
            `);
            const baseUrl = getAppBaseUrl(req);
            const actionUrl = `${baseUrl}/app/feedback-admin?id=${ticket.id}`;
            const subject = `New ${type} feedback: ${ticket.title}`;
            const body = `${submitterName} submitted a ${type} (${sev} severity).`;
            for (const a of allRows<{ id: string; email: string | null; username: string | null }>(admins)) {
              await db.execute(sql`
                INSERT INTO notifications (company_id, user_id, type, title, message, action_url, is_read)
                VALUES (${user.companyId}, ${a.id}, 'feedback_submitted', ${subject}, ${body}, ${actionUrl}, FALSE)
              `).catch(() => {});
              if (a.email) {
                sendGenericNotificationEmail({
                  recipientName: a.username || "Admin",
                  email: a.email,
                  title: subject,
                  body,
                  actionUrl,
                }).catch(() => {});
              }
            }
          }
        } catch (notifyErr) {
          console.warn("[Feedback] Admin notification error:", notifyErr instanceof Error ? notifyErr.message : String(notifyErr));
        }

        res.status(201).json(ticket);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        res.status(500).json({ message: "Failed to create feedback ticket: " + msg });
      }
    },
  );

  // GET /api/feedback — list tickets with scope-based filtering
  app.get("/api/feedback", requireAuth, async (req: SessionRequest, res: Response) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(401).json({ message: "User not found" });
      const platform = isPlatformRole(user.role);
      const admin = isAdminRole(user.role);

      const {
        companyId: filterCompanyId,
        type: filterType,
        status: filterStatus,
        severity: filterSeverity,
        priorityFix,
        assignedUserId,
        from,
        to,
      } = req.query as Record<string, string | undefined>;

      // Build dynamic WHERE clause via parameterized fragments.
      const conditions: ReturnType<typeof sql>[] = [];
      if (platform) {
        if (filterCompanyId) conditions.push(sql`company_id = ${filterCompanyId}`);
      } else if (admin) {
        // Tenant admins see only their company's tickets.
        if (!user.companyId) return res.json([]);
        conditions.push(sql`company_id = ${user.companyId}`);
      } else {
        // Regular users see only their own submissions.
        conditions.push(sql`submitter_user_id = ${user.id}`);
      }
      if (filterType && ALLOWED_TYPES.has(filterType)) conditions.push(sql`type = ${filterType}`);
      if (filterStatus && ALLOWED_STATUSES.has(filterStatus)) conditions.push(sql`status = ${filterStatus}`);
      if (filterSeverity && ALLOWED_SEVERITIES.has(filterSeverity)) conditions.push(sql`severity = ${filterSeverity}`);
      if (priorityFix === "true") conditions.push(sql`priority_fix = TRUE`);
      if (assignedUserId) conditions.push(sql`assigned_user_id = ${assignedUserId}`);
      if (from) conditions.push(sql`created_at >= ${from}::timestamp`);
      if (to) conditions.push(sql`created_at <= ${to}::timestamp`);

      let where = sql``;
      if (conditions.length > 0) {
        where = sql` WHERE `;
        for (let i = 0; i < conditions.length; i++) {
          where = sql`${where}${conditions[i]}`;
          if (i < conditions.length - 1) where = sql`${where} AND `;
        }
      }
      const result = await db.execute(sql`
        SELECT * FROM feedback_tickets${where}
        ORDER BY priority_fix DESC, created_at DESC
        LIMIT 500
      `);
      res.json(allRows<FeedbackTicketRow>(result));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ message: "Failed to load feedback: " + msg });
    }
  });

  // GET /api/feedback/:id — single ticket (with auth scope check)
  app.get("/api/feedback/:id", requireAuth, async (req: SessionRequest, res: Response) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(401).json({ message: "User not found" });
      const result = await db.execute(sql`SELECT * FROM feedback_tickets WHERE id = ${req.params.id}`);
      const ticket = firstRow<FeedbackTicketRow>(result);
      if (!ticket) return res.status(404).json({ message: "Ticket not found" });
      const platform = isPlatformRole(user.role);
      const admin = isAdminRole(user.role);
      if (!platform) {
        if (admin) {
          if (ticket.company_id !== user.companyId) {
            return res.status(403).json({ message: "Access denied" });
          }
        } else if (ticket.submitter_user_id !== user.id) {
          return res.status(403).json({ message: "Access denied" });
        }
      }
      res.json(ticket);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ message: "Failed to load ticket: " + msg });
    }
  });

  // PATCH /api/feedback/:id — admin-only updates (status, assignment, priority)
  app.patch("/api/feedback/:id", requireAuth, async (req: SessionRequest, res: Response) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user || !isAdminRole(user.role)) {
        return res.status(403).json({ message: "Admin access required" });
      }
      const platform = isPlatformRole(user.role);
      const existingRes = await db.execute(sql`SELECT * FROM feedback_tickets WHERE id = ${req.params.id}`);
      const existing = firstRow<FeedbackTicketRow>(existingRes);
      if (!existing) return res.status(404).json({ message: "Ticket not found" });
      if (!platform && existing.company_id !== user.companyId) {
        return res.status(403).json({ message: "Access denied: ticket belongs to another company" });
      }

      const { status, priorityFix, assignedUserId } = req.body as {
        status?: string;
        priorityFix?: boolean;
        assignedUserId?: string | null;
      };

      const sets: ReturnType<typeof sql>[] = [];
      let newStatus: string | undefined;
      if (typeof status === "string") {
        if (!ALLOWED_STATUSES.has(status)) return res.status(400).json({ message: "Invalid status" });
        sets.push(sql`status = ${status}`);
        newStatus = status;
      }
      if (typeof priorityFix === "boolean") sets.push(sql`priority_fix = ${priorityFix}`);
      if (assignedUserId !== undefined) sets.push(sql`assigned_user_id = ${assignedUserId}`);
      if (sets.length === 0) return res.status(400).json({ message: "No fields to update" });
      sets.push(sql`updated_at = NOW()`);

      let setClause = sql``;
      for (let i = 0; i < sets.length; i++) {
        setClause = sql`${setClause}${sets[i]}`;
        if (i < sets.length - 1) setClause = sql`${setClause}, `;
      }
      const updated = await db.execute(sql`
        UPDATE feedback_tickets SET ${setClause} WHERE id = ${req.params.id} RETURNING *
      `);
      const ticket = firstRow<FeedbackTicketRow>(updated);

      // Notify submitter on status change (best-effort).
      if (ticket && newStatus && newStatus !== existing.status) {
        try {
          const baseUrl = getAppBaseUrl(req);
          const actionUrl = `${baseUrl}/app/my-feedback?id=${ticket.id}`;
          const subject = `Your feedback "${ticket.title}" was updated`;
          const body = `Status changed to ${STATUS_LABELS[newStatus] || newStatus}.`;
          if (ticket.company_id) {
            await db.execute(sql`
              INSERT INTO notifications (company_id, user_id, type, title, message, action_url, is_read)
              VALUES (${ticket.company_id}, ${ticket.submitter_user_id}, 'feedback_status_changed', ${subject}, ${body}, ${actionUrl}, FALSE)
            `).catch(() => {});
          }
          if (ticket.submitter_email) {
            sendGenericNotificationEmail({
              recipientName: ticket.submitter_name || "User",
              email: ticket.submitter_email,
              title: subject,
              body,
              actionUrl,
            }).catch(() => {});
          }
        } catch (notifyErr) {
          console.warn("[Feedback] Status notify error:", notifyErr instanceof Error ? notifyErr.message : String(notifyErr));
        }
      }
      res.json(ticket);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ message: "Failed to update ticket: " + msg });
    }
  });

  // GET /api/feedback/:id/comments — list comments (internal hidden from non-admins)
  app.get("/api/feedback/:id/comments", requireAuth, async (req: SessionRequest, res: Response) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(401).json({ message: "User not found" });
      const ticketRes = await db.execute(sql`SELECT * FROM feedback_tickets WHERE id = ${req.params.id}`);
      const ticket = firstRow<FeedbackTicketRow>(ticketRes);
      if (!ticket) return res.status(404).json({ message: "Ticket not found" });
      const platform = isPlatformRole(user.role);
      const admin = isAdminRole(user.role);
      if (!platform) {
        if (admin) {
          if (ticket.company_id !== user.companyId) return res.status(403).json({ message: "Access denied" });
        } else if (ticket.submitter_user_id !== user.id) {
          return res.status(403).json({ message: "Access denied" });
        }
      }
      const result = await db.execute(sql`
        SELECT * FROM feedback_ticket_comments
        WHERE ticket_id = ${req.params.id}
        ORDER BY created_at ASC
      `);
      const comments = allRows<FeedbackCommentRow>(result);
      res.json(admin ? comments : comments.filter((c) => !c.is_internal));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ message: "Failed to load comments: " + msg });
    }
  });

  // POST /api/feedback/:id/comments — add a comment
  app.post("/api/feedback/:id/comments", requireAuth, async (req: SessionRequest, res: Response) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(401).json({ message: "User not found" });
      const ticketRes = await db.execute(sql`SELECT * FROM feedback_tickets WHERE id = ${req.params.id}`);
      const ticket = firstRow<FeedbackTicketRow>(ticketRes);
      if (!ticket) return res.status(404).json({ message: "Ticket not found" });
      const platform = isPlatformRole(user.role);
      const admin = isAdminRole(user.role);
      if (!platform) {
        if (admin) {
          if (ticket.company_id !== user.companyId) return res.status(403).json({ message: "Access denied" });
        } else if (ticket.submitter_user_id !== user.id) {
          return res.status(403).json({ message: "Access denied" });
        }
      }
      const { body, isInternal } = req.body as { body?: string; isInternal?: boolean };
      if (!body || !body.trim()) return res.status(400).json({ message: "Comment body is required" });
      // Only admins can mark a comment as internal.
      const internalFlag = !!isInternal && admin;
      const authorName =
        [(user as any).firstName, (user as any).lastName].filter(Boolean).join(" ") ||
        (user as any).username ||
        "User";
      const inserted = await db.execute(sql`
        INSERT INTO feedback_ticket_comments (ticket_id, author_user_id, author_name, body, is_internal)
        VALUES (${req.params.id}, ${user.id}, ${authorName}, ${body.trim()}, ${internalFlag})
        RETURNING *
      `);
      res.status(201).json(firstRow<FeedbackCommentRow>(inserted));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ message: "Failed to add comment: " + msg });
    }
  });
}
