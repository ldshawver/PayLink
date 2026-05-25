# Marketing Homepage Lock — MyPayLink

> **CRITICAL:** MyPayLink is payroll / HR / workforce / finance software.
> It is **NOT** LUXit, a CRM, or a marketing-automation app.
> See also: `docs/project-scope-guardrails.md`

## Architecture — Two-Layer Homepage

PayLink's public homepage is served in two layers:

| Layer | File | When served |
|-------|------|-------------|
| **Primary** | `public-site/public/index.html` | Always — served directly by Express static middleware at `/` |
| **Fallback** | `client/src/pages/marketing-home.tsx` | Only if `public-site/public/index.html` is missing |

The static HTML is served first by `server/vite.ts` via `resolveMarketingPath()`. If the file exists, it wins. The React `<MarketingHomePage />` is the fallback.

## Approved Route Behavior

| URL | Page | Notes |
|-----|------|-------|
| `/` | Static HTML marketing homepage | `public-site/public/index.html` — never replace with login or clock-in |
| `/login` | React Login page | Separate Vite/React route |
| `/clock-in` | React Time-clock kiosk | Separate Vite/React route |
| `/app.html?route=/login` | React app shell → Login | Used by static site's Sign In links |
| `/app/*` | Authenticated React app | Requires valid session |
| `/platform/*` | Platform console | Requires platform role |

## Required Elements (static homepage `public-site/public/index.html`)

1. **PayLink branding** — logo + "PayLink" name throughout
2. **No third-party branding** — no "Alavont", no "LUXit", no competitor names
3. **Marketing headline** — `<h1>` describing PayLink
4. **Time punch card / clock machine visual** — `.clock-machine` with analog clock display
5. **Clock In button** — opens the `#punchModal` overlay, NOT navigating away
6. **Clock-in modal** — `#punchModal` with employee number + PIN fields
7. **Employee number field** — `#punchEmpNum`
8. **PIN field** — `#punchPin`
9. **Features section** — marketing features below the hero
10. **Footer** — with PayLink copyright and links to `/login`, `/signup`, etc.

## Required Elements (React fallback `client/src/pages/marketing-home.tsx`)

Must mirror the above but as React:
- `data-testid="time-punch-card"` — punch card visual
- `data-testid="button-hero-clock-in"` — Clock In button
- `data-testid="modal-clock-in"` — clock-in dialog
- `data-testid="input-modal-employee-number"` — employee number input
- `data-testid="input-modal-pin"` — PIN input
- Comment header: `APPROVED MYPAYLINK MARKETING HOMEPAGE — DO NOT MODIFY WITHOUT ADMIN APPROVAL`

## What Cannot Be Changed Without Admin Approval

1. **`/` must serve the static marketing homepage** — `public-site/public/index.html` must exist and contain the punch card + modal.
2. **`/login` must remain a separate route** — never merged with or replacing the homepage.
3. **`/clock-in` must remain a separate route** — never replaces homepage.
4. **Punch card visual must remain** in the hero.
5. **Clock In must open a modal** — not navigate away from the homepage.
6. **Modal must contain employee number + PIN fields.**
7. **No non-PayLink branding** — "Alavont", "LUXit", or any other company name must not appear.
8. **Marketing sections below hero must remain** (features, why, CTA, footer).

## Build Guard

Run to validate all requirements:
```bash
node scripts/check-homepage-guard.js
```

Add to CI pipeline to prevent regressions.

## External Builder Guardrail

Replit, AI builders, and automated code generators must treat **both** homepage files as **locked production content**:
- `public-site/public/index.html`
- `client/src/pages/marketing-home.tsx`

They may only be edited when the request **explicitly** asks to change the marketing website. Login, clock-in, app dashboard, onboarding, sales, SaaS/platform, contractor hub, or payroll work must **not** rewrite the marketing homepage.

## How to Intentionally Update

1. Edit `public-site/public/index.html` for the primary static homepage.
2. Mirror changes in `client/src/pages/marketing-home.tsx` for the React fallback.
3. All required elements (see above) must still be present after the change.
4. Run `node scripts/check-homepage-guard.js` and confirm it passes.
5. Update the "Last Approved" section below.

## Last Approved

Date: 2026-05-25  
Change: Removed "Alavont Holdings" branding contamination from static homepage. Added React fallback with time punch card visual + Clock In modal (employee number + PIN). Both layers verified with homepage guard script.
