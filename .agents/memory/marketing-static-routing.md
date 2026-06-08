---
name: Marketing pages served as static HTML (not React)
description: Why /signup, /, /demo etc. load static public-site HTML and never the React SPA pages
---

# Marketing pages are static HTML, NOT React

The marketing funnel pages are served as **static HTML** from `public-site/public/*.html`,
intercepting the request BEFORE the React SPA catch-all ever runs.

The page list lives in a `MARKETING_PAGES` array duplicated in TWO places:
- `server/vite.ts` (dev mode)
- `server/static.ts` (production)

Both register `app.get('/<page>', sendFile(<page>.html))` for every name in that array
(currently: demo, features, pricing, security, contact, vendor-portal, terms, privacy,
signup, clock) plus a protected `/` → `index.html` handler.

**Consequence:** Any React page registered for one of these paths (e.g. a `/signup` route
in `client/src/App.tsx`) is DEAD CODE — the static handler wins and the SPA never loads
there. `/` → static `index.html`, `/signup` → static `signup.html`, etc. React pages only
load for non-marketing paths like `/login`, `/app/*`, `/platform/*`.

**Why:** The marketing homepage/funnel is intentionally locked to static HTML (see the
"MARKETING HOMEPAGE LOCK" comments and replit.md). The static `signup.html` is the
canonical signup: it POSTs to `/api/trial/signup`, then `/api/auth/login`, then redirects
to `/app/onboarding`.

**How to apply:** Before building/editing a React page for a marketing path, check the
`MARKETING_PAGES` arrays first. If the path is there, edit the static HTML in
`public-site/public/` instead — a React page for that path will never render. Do not
create a parallel React version; it only creates a confusing duplicate.
