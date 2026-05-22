# Marketing Page Lock — PayLink

## Approved Route Behavior

| URL | Page | Notes |
|-----|------|-------|
| `/` | Marketing homepage | Public — never replace with login or clock-in |
| `/login` | Login page | Separate route — authenticated users redirect to `/app` |
| `/clock-in` | Time-clock kiosk | Also accessible as `/time-clock` |
| `/app/*` | Authenticated app | Requires valid session |
| `/platform/*` | Platform console | Requires platform role |

## Protected Files

| File | Purpose |
|------|---------|
| `client/src/pages/marketing-home.tsx` | Approved marketing homepage component |
| `client/src/App.tsx` (lines ~584-598) | Route rule: unauthenticated `/` → `<MarketingHomePage />` |

## What Cannot Be Changed Without Admin Approval

1. **The `"/"` route must serve `<MarketingHomePage />`** for unauthenticated visitors — never redirect to `/login`, `/time-clock`, or any partial page.
2. **`/login` must remain a separate route** — it must not be merged with or replace the marketing homepage.
3. **`/clock-in` must remain a separate route** — it must not replace the marketing homepage.
4. **`marketing-home.tsx` hero section, CTA section, and features grid** must not be removed or replaced with login/clock-in UI without explicit admin sign-off.

## How to Intentionally Update the Marketing Page

1. Edit `client/src/pages/marketing-home.tsx` directly.
2. The comment header `APPROVED MARKETING PAGE — DO NOT MODIFY WITHOUT ADMIN APPROVAL` must remain.
3. After updating, update this document's "Last approved" date.
4. Ensure all three routes (`/`, `/login`, `/clock-in`) still serve distinct content after the change.

## Feature Flag (env)

Set `MARKETING_PAGE_LOCKED=true` in production environment to document the policy intent.
This flag is informational — the actual protection is enforced by the routing logic in `App.tsx`.

## Last Approved

Commit: `b5ea87a56fa2064d24c935f8ef034d71d76e577e`  
Date: 2026-05-21  
Author: Admin-approved marketing homepage restore
