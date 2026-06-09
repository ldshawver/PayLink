---
name: CI lockfile firewall URLs break GitHub Actions
description: Why pushes to GitHub main can deadlock on failing required CI checks
---
The committed `package-lock.json` contains `resolved` URLs pointing to
`http://package-firewall.replit.local/...` (Replit's internal package proxy).

**Symptom:** GitHub Actions `npm ci` fails at install with
`npm error code EAI_AGAIN ... getaddrinfo EAI_AGAIN package-firewall.replit.local`.
The `build`, `test`, and `typecheck` jobs die during install (never run their
real step); only jobs without `npm ci` (e.g. `repo-audit`) pass.

**Why it matters:** `main` is protected by a GitHub ruleset that requires those
status checks to pass. Because the checks can never pass while the lockfile points
at the unreachable host, NO push to `main` is accepted — and the fix itself can't
be landed without a push. That is a deadlock only the repo owner can break by
temporarily relaxing/bypassing the branch ruleset, or by landing a corrected
lockfile via an allowed path.

**How to apply:** If a GitHub push to `main` is rejected with GH013 / "required
status checks", check the Actions logs for the firewall host before assuming the
code is broken. Deploy (`deploy-app.yml`) uses pnpm, not `npm ci`, so it is not
affected — this is a CI-only break. The durable fix is regenerating the lockfile
against the public npm registry (sensitive: touches package-lock.json).
