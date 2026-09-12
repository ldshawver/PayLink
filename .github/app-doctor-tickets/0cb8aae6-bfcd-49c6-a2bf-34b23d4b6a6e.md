# App Doctor Repair Ticket

- Ticket ID: 0cb8aae6-bfcd-49c6-a2bf-34b23d4b6a6e
- Report: GET /api/dashboard/exceptions failed
- Severity: minor
- Required approver: admin

## Proposed patch
```diff
diff --git a/server/routes.ts b/server/routes.ts
@@
-      // Run each dashboard exception query directly; any query failure returns a route-level 500.
+      const collectExceptionSource = async (sourceName, collect) => {
+        try { await collect(); }
+        catch (err) {
+          console.error(`[DashboardExceptions] ${sourceName} failed`, err);
+          // Record an App Doctor report with sourceName, route, companyId, and sanitized error message.
+          // Continue so the dashboard can show remaining exception groups instead of a full 500.
+        }
+      };
+      await collectExceptionSource('missing_clock_outs', async () => { /* existing query */ });
```