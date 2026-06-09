---
name: CI lockfile firewall URLs break GitHub Actions
description: Troubleshooting rule — GH013 + required checks failing at npm ci on GitHub
---
**Rule of thumb:** If a GitHub push to a protected branch is rejected with
`GH013` / "required status checks", and those checks fail during dependency
install (`npm ci`) rather than at the real build/test step, inspect the committed
`package-lock.json` for `resolved` hosts that are NOT a public registry. A
non-public host in the lockfile is the usual culprit.

**This repo's specific case:** `package-lock.json` carries `resolved` URLs
pointing at `http://package-firewall.replit.local/...` (Replit's internal package
proxy). That host only resolves inside Replit, so GitHub Actions `npm ci` dies
with `EAI_AGAIN getaddrinfo package-firewall.replit.local`. Jobs that run
`npm ci` (build/test/typecheck) fail at install; jobs without it (e.g.
`repo-audit`) still pass.

**Why it can deadlock:** when the branch ruleset requires those checks AND the
fix lives in the lockfile, a *direct* push to `main` can never satisfy the checks.
Escape routes: (a) repo owner relaxes/bypasses the ruleset, or (b) land the
corrected lockfile through the normal PR flow — `ci.yml` runs on push to
non-`main` branches and on PRs, so a fixed lockfile on a feature branch makes the
PR checks pass, then merge.

**Durable fix:** rewrite the lockfile `resolved` hosts to the public registry
(`https://registry.npmjs.org`); integrity hashes are content-based and stay valid.
This is CI-only — `deploy-app.yml` uses pnpm (not `npm ci`), so production deploys
are unaffected. Treat lockfile edits as sensitive.
