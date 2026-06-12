---
name: Demo login auth whitelist
description: /demo/login was missing from the global requireAuth allowlist in routes.ts, causing 401 on POST /api/demo/login
---

## The Rule

`/demo/login` must be present in the public-path allowlist inside the global `requireAuth` middleware at approximately line 1597 of `server/routes.ts`.

## Why

The global `app.use("/api", ...)` middleware at ~line 1593 applies `requireAuth` to every `/api/*` route except those explicitly listed. Only `/demo/provision` was listed; `/demo/login` was omitted. This caused `POST /api/demo/login` to return 401 "Not authenticated" in 1ms — before the actual handler at line 21052 could run.

## How to Apply

Whenever a new public `/api/*` endpoint is added (like a new demo, auth, or onboarding flow), also add its path to the allowlist at line ~1597:

```ts
|| req.path === "/demo/provision" || req.path === "/demo/login"
```

The full allowlist covers: `/auth/login`, `/auth/logout`, `/auth/me`, `/auth/pin-login`, `/auth/token-restore`, `/time-clock/*`, `/pay/*`, `/stripe/publishable-key`, `/payments/stripe-status/*`, `/webhooks/product-events`, `/webhooks/esign/*`, `/demo/provision`, `/demo/login`, `/trial/signup`, `/analytics/event`, `/license/request`, `/portal/*`.
