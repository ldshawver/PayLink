# Dashboard Widget Registry

This file documents every widget (dashlet) on the Dashboard page, including its data source, target page, required permissions, and live-refresh behavior.

## Widget Inventory

### 1. Clock Status Card (`DashboardClockCard`)
- **Source Queries**: `/api/workers`, `/api/time-entries`, `/api/time-punches`, `/api/dashboard/clock-status`
- **Scope**: Current user's linked worker only (`user.workerId`)
- **States** (all six fully implemented):
  - `clocked_out` — Worker has not clocked in today; Clock In button shown
  - `clocked_in` — Worker has an open time entry; "LIVE" badge shown; Break/Clock Out buttons shown
  - `on_break` — Last punch is `break_start`; End Break button shown
  - `back_from_break` — Last punch is `break_end` within the past 30 min; "LIVE" badge shown; Break/Clock Out buttons shown
  - `pending_punch_approval` — Worker has a `clock_in_requests` record with `status = 'pending'`; yellow banner + "Awaiting Approval" badge shown; punch buttons disabled
  - `missing_punch` — Worker has an unclosed time entry from a prior day (no `clock_out`); red banner shown; Clock In still offered after correction
- **Target Page**: `/app/attendance` (worker name, icon, and "View timecard" link all navigate there)
- **Required Permission**: Authenticated user with linked worker
- **Refresh**: Punch actions invalidate `/api/workers`, `/api/time-entries`, `/api/time-punches` caches; `/api/dashboard/clock-status` refreshes on each query cycle

### 2. News (`NewsDashlet`)
- **Source**: Static / platform announcements
- **Scope**: Platform-wide (not company-scoped)
- **Target Page**: N/A (informational)
- **Required Permission**: Any authenticated user
- **Refresh**: Static content

### 3. Exception Summary (`ExceptionSummaryDashlet`)
- **Source Query**: `/api/dashboard/exceptions`
- **Scope**: Role-based (see Scope Enforcement table)
- **Shows**: Pending approvals count (clock_in_request), missing clock-outs count (time_entry), high-OT count
- **Target Page**: "View All" → `/app/attendance?tab=clock-in-approvals`
- **Required Permission**: `admin`, `manager`, and all equivalent roles (see `ADMIN_ROLES` in `dashboard.tsx`)
- **Refresh**: On demand (TanStack Query cache)

### 4. Messages (`MessagesDashlet`)
- **Source Query**: N/A (future: `/api/messages`)
- **Scope**: Current user's messages
- **Target Page**: `/app/messages`
- **Required Permission**: Any authenticated user
- **Refresh**: N/A

### 5. My Requests (`RequestsDashlet`)
- **Source Query**: `/api/dashboard/my-requests`
- **Scope**: Strictly scoped to `user.workerId` — no other worker's data is returned, regardless of role
- **Shows**: Time-off requests + punch approval requests; each includes `companyName`, `costCenterName`, `department`, `status`, submission date
- **Target Page**: Each row links to `/app/attendance?tab=time-off` (time-off) or `/app/attendance` (punch approvals)
- **Required Permission**: Any authenticated user with a linked worker
- **Refresh**: On demand

### 6. Awaiting My Approval (`RequestAuthorizationsDashlet`)
- **Source Query**: `/api/dashboard/pending-approvals`
- **Scope**:
  - Non-managers: always returns `[]` (empty)
  - Managers/supervisors: own direct subordinates only (`workers.manager_id = session_user.workerId`)
  - Admin roles: all workers in company (`companyId`)
- **Shows**: Requester name, employee number, company, cost center, job name, description, status, submission date
- **Actions**: Inline "Approve" (✓) / "Deny" (✗) buttons per row; links to source pages
- **Target Page**: `/app/attendance?tab=clock-in-approvals` (punch) or `/app/attendance?tab=time-off` (time-off)
- **Required Permission**: `admin`, `manager`, and all equivalent roles
- **Refresh**: On demand + after inline action (cache invalidation)

### 7. Exceptions (`ExceptionsDashlet`)
- **Source Query**: `/api/dashboard/exceptions`
- **Scope** (enforced server-side):
  - Employee (non-manager, non-admin): only their own missing clock-outs (`worker_id = user.workerId`)
  - Manager/supervisor: subordinates only (workers where `manager_id = user.workerId` in same company)
  - Admin: all workers in company (`companyId`)
- **Exception Types**:
  - `clock_in_request` (status: `pending_approval`): Early/late/unscheduled clock-in awaiting manager approval
    - Fields: `workerName`, `employeeNumber`, `companyName`, `costCenterName`, `jobName`, `date`, `time`, `exceptionType`
    - Actions: `canApprove` (managers only), `canComment` (managers), `canEdit` (admins)
  - `time_entry` (status: `action_required`): Missing clock-out from prior day
    - Actions: `canApprove` (managers), `canComment` (managers), `canEdit` (managers)
  - `time_entry` (status: `pending`): High OT (>4h) or unscheduled shift needing review
    - Actions: `canApprove` (all managers), `canEdit` (admins), `canComment` (managers)
- **Target Page**: Each row links to its `actionUrl` (`/app/attendance` or `/app/attendance?tab=clock-in-approvals`)
- **Required Permission**: Any authenticated user (employees see only own data; managers see subordinates)
- **Refresh**: On demand + after inline action

### 8. Schedule Summary — Subordinates (`ScheduleSummarySubordinatesDashlet`)
- **Source Query**: `/api/schedules`, `/api/workers`
- **Scope**: Company-scoped (all workers the manager can see)
- **Target Page**: `/app/schedule`
- **Required Permission**: `admin`, `manager`
- **Refresh**: On demand

### 9. Schedule Summary (`ScheduleSummaryDashlet`)
- **Source Query**: `/api/schedules`
- **Scope**: Company-scoped (today's schedules for current user's company)
- **Target Page**: `/app/schedule`
- **Required Permission**: Any authenticated user
- **Refresh**: On demand

### 10. Who's In/Out (`WhosInOutDashlet`)
- **Source Query**: `/api/time-entries`, `/api/workers`
- **Scope**: Company-scoped (today's entries with open clock-ins)
- **Target Page**: Each row links to `/app/attendance`
- **Required Permission**: Any authenticated user
- **Refresh**: On demand

### 11. Timesheet Summary (`TimesheetSummaryDashlet`)
- **Source Query**: `/api/time-entries`
- **Scope**: Company-scoped (hours this week, counts by status)
- **Target Page**: `/app/attendance`
- **Required Permission**: Any authenticated user
- **Refresh**: On demand

---

## Scope Enforcement Summary

| Widget | Company Scoped | Hierarchy Scoped | Employee Self-Only | Non-Manager Returns Empty |
|--------|---------------|-----------------|-------------------|--------------------------|
| Clock Status Card | ✅ (worker.companyId) | N/A | ✅ (own workerId) | N/A |
| `/api/dashboard/clock-status` | ✅ | N/A | ✅ (own workerId) | N/A |
| Exception Summary | ✅ | ✅ (via exceptions endpoint) | employees see own only | — |
| My Requests | ✅ | N/A | ✅ (own workerId) | — |
| Awaiting My Approval | ✅ | ✅ (direct subordinates) | — | ✅ |
| Exceptions | ✅ | ✅ (direct subordinates) | ✅ (employee sees own) | — |
| Schedule Summary (Subs) | ✅ | ✅ | — | — |
| Schedule Summary | ✅ | — | — | — |
| Who's In/Out | ✅ | — | — | — |
| Timesheet Summary | ✅ | — | — | — |

---

## Out-of-Schedule Punch Approval Flow

1. Worker clocks in outside the configured grace window (see Tolerance Configuration below) via the kiosk (`POST /api/time-clock/clock-in-session`)
2. A `clock_in_requests` record is created with `status = 'pending'` and `request_type` of `early_clockin`, `late_clockin`, or `unscheduled_clockin`
3. The worker's DashboardClockCard shows `pending_punch_approval` state with a yellow banner
4. Supervisors/managers receive email + SMS notifications (via configured templates)
5. The pending punch appears in:
   - **Exceptions widget** — with inline approve/deny for managers
   - **Awaiting My Approval widget** — with inline approve/deny for managers
   - **Attendance page → Clock-In Approvals tab**
6. Manager approves via `PATCH /api/clock-in-requests/{id}/approve`:
   - A `time_punch` and `time_entry` are created for the worker
   - Worker's DashboardClockCard transitions to `clocked_in` state on next query cycle
7. Manager denies via `PATCH /api/clock-in-requests/{id}/deny`:
   - Worker's DashboardClockCard returns to `clocked_out`
   - No punch or entry is created
8. Approved/denied status is reflected in the worker's attendance record and payroll eligibility

---

## Tolerance Configuration

The early/late clock-in grace period is **per-company configurable** via the Company Settings page (Stations tab → "Clock-In Grace Period"). The value is stored in `companies.clock_in_grace_minutes` (default: 10 minutes).

- Schema field: `companies.clock_in_grace_minutes` (INTEGER, NOT NULL, DEFAULT 10)
- Auto-migration: added at startup if the column does not exist
- API route: `PATCH /api/companies/:id` — accepts `clockInGraceMinutes` (integer, 1–120)
- UI: Company Settings → Stations → "Clock-In Grace Period" card — per-company number input + Save button
- Usage: `server/routes.ts` `/api/time-clock/clock-in-session` reads `companyObj.clockInGraceMinutes` to determine the `GRACE_MINUTES` threshold; falls back to `10` if the company record doesn't have the field yet

When a punch falls outside the grace window, a `clock_in_requests` record is created and:
1. In-app notifications are inserted into `notifications` table for all manager-role users of that company
2. Email + SMS notifications are sent to managers via the notification system
3. The punching worker's DashboardClockCard transitions to `pending_punch_approval` state
