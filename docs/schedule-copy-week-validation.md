# Copy Published Week Validation Notes

Status: **code implemented + focused tests added / pending repo validation**.

## Repo commands available

The root `package.json` currently exposes these scripts:

- `pnpm dev`
- `pnpm build`
- `pnpm start`
- `pnpm check`
- `pnpm typecheck`
- `pnpm db:push`

There is no `lint`, `lint:ratchet`, `test`, or E2E/browser script in the root `package.json`. The nested `public-site/package.json` only exposes `start` and `dev` for the public site and is not the scheduler app validation harness.

## Validation commands run

### Passed

- `npx tsx server/__tests__/schedule-copy-week.test.ts`
  - Proves copy-week backend/service behavior including published-source copy, draft-source rejection, future target validation, Sunday week-start validation, draft copied shifts, new IDs, copied fields, reset notification/payroll/export/approval/completion metadata, weekday and overnight mapping, merge behavior, replace behavior, published target protection, and audit logging.
- `npx tsx client/src/pages/schedule-copy-week.workflow.test.ts`
  - Proves the closest available frontend workflow coverage without a browser harness: required UI controls and warning exist, the UI posts to `/api/schedules/copy-week`, copy mutation does not notify employees, and copied drafts can use existing edit and publish workflows.

### Blocked by existing repo issues

- `pnpm typecheck`
  - Fails before this feature can be accepted as clean.
  - Observed blockers include missing ambient/module types and existing unrelated server errors:
    - `server/db.ts`: missing declaration file for `pg` and implicit `any` parameters.
    - `server/routes.ts`: missing `express-serve-static-core` types.
    - `server/routes.ts`: existing authorization audit-log object mismatch near the 11k-line region.
    - `server/routes.ts`: existing possibly-undefined user passed to a helper near the 11k-line region.
    - `server/tenant-context.ts`: implicit `any` parameter.
    - `server/vite.ts`: missing `nanoid` types.
- `pnpm check`
  - Fails on the same server blockers plus existing repo-wide client errors unrelated to the copy-week implementation, including:
    - `client/src/components/reports/timesheet-report.tsx`: `regularHours` and `Date | null` type mismatches.
    - `client/src/pages/biz-docs.tsx`: `DocType` state type mismatch.
    - `client/src/pages/invoices.tsx`: missing `name` property on customer type.
    - `client/src/pages/login.tsx`: `AuthUser` not exported from `use-auth`.
    - `client/src/pages/mfa-settings.tsx`: mutation returns `Response` instead of `EnrollData`.
    - `client/src/pages/my-profile.tsx`: emergency contact fields missing from worker type.
    - `client/src/pages/onboarding.tsx`, `client/src/pages/platform-audit.tsx`, and several server files: Set/Map iteration errors from current TS target/settings.
    - `client/src/pages/schedule.tsx`: pre-existing `timeFormat` missing references and pre-existing schedule form reset shape mismatches.
- `pnpm lint:ratchet`
  - Not a valid acceptance command for this repo because the script/command does not exist.

## Copy-week files and TypeScript impact

No copy-week-specific TypeScript errors appeared in the `pnpm typecheck` or `pnpm check` output for:

- `server/schedule-copy-week.ts`
- `server/__tests__/schedule-copy-week.test.ts`
- `client/src/pages/schedule-copy-week.workflow.test.ts`

The global `pnpm check` output still reports pre-existing errors in `client/src/pages/schedule.tsx`; the reported line families are existing `timeFormat` and form-shape issues, not the copy-week dialog/mutation lines.

The global `pnpm typecheck`/`pnpm check` output still reports pre-existing errors in `server/routes.ts`; the reported line families are existing authorization audit and undefined-user issues, not the `/api/schedules/copy-week` route.

## E2E/browser harness status

No Playwright, Cypress, Vitest browser, Jest DOM, or root `test:e2e` script was found in `package.json`. Because there is no runnable browser harness in this repo, automated browser E2E validation is not available from the current scripts. The added frontend workflow test is the closest available automated coverage.

## Manual QA checklist

Run this before marking the feature accepted in an environment with seed data or a staging database:

1. Sign in as an admin or scheduler/manager with access to the target company.
2. Open `/app/schedule`.
3. Navigate to a week that already contains published shifts.
4. Click **Copy Published Week**.
5. Confirm the source week defaults to the visible schedule week.
6. Select the same company.
7. Select a future target week.
8. If the target week already has shifts, confirm the warning appears.
9. Choose **Merge — add draft shifts** and click **Copy as Draft**.
10. Confirm the copied target-week shifts are visible as **Draft** and original published source shifts remain unchanged.
11. Confirm Monday source shifts land on Monday in the target week, Tuesday on Tuesday, and overnight shifts preserve start/end times.
12. Edit one copied draft shift and save it.
13. Publish the copied draft shifts through the existing publish flow.
14. Confirm employees are notified only during publish, not during copy.
15. Repeat with **Replace existing draft shifts only**.
16. Confirm replace removes draft/unpublished target shifts in the selected company/week/department.
17. Confirm replace does **not** delete any published target shifts.
18. Confirm `schedule_audit_logs` contains a `copy_week` entry with actor, company, source week, target week, mode, copied count, and timestamp.
19. Attempt copy as an unauthorized tenant user and confirm the endpoint rejects access.

## Acceptance status

Do not mark this feature complete until either:

- the repo-wide TypeScript blockers are fixed and `pnpm typecheck` / `pnpm check` pass, or
- product/release owners explicitly accept the documented unrelated repo-wide blockers and approve copy-week based on the focused passing tests plus manual QA.
