# Staging rollout — employee numbers, then contractor create, then invite

Prepared, not executed. Nothing here has been applied to staging or production.
Merging to `main` deploys staging (`deploy-app.yml` takes no database backup),
so these drafts stay drafts until there is a written go-ahead.

This restack does **not** include company-scoped sign-in or hashed PINs.
Draft #205 (migrations 0031/0032) stays unmerged and is not a prerequisite.
The original #206/#207 runbook that applied 0031 is historical only.

## Order

1. Allocator PR (migration `0041`, per-company `YYNN` numbers). Code works
   before `0041` via an advisory lock; the unique index exists only after
   `0041`.
2. Contractor create (inactive worker + checklist). No migration.
3. This invite PR. No migration. It needs the create PR's onboarding rows.

`0041` is the next free number after `0037` on main, open `0038`/`0039`
(#216/#217), and `0040` claimed by #219. If another migration takes `0041`
first, renumber it before applying. Do not reuse 0031–0040.

## Before any merge

Take and verify a backup (`pg_dump -Fc`), restore it onto a disposable
database, and confirm row counts. Apply `0041` only on that copy first.
`0041` refuses to run if a company already has duplicate employee numbers.
Nothing is renumbered.

## Invite acceptance

Staging SMTP is live. Use only a designated test mailbox. A failed send
returns 502, revokes the undelivered link, and allows a retry. The email
has the setup link and does not contain a password or PIN.

## Rollback

Redeploy the previous `main` commit. `0041` is additive and can stay; older
code ignores `employee_number_counters`. Pending invites stay in
`account_invites` and still work on the previous accept page.
