---
name: Workers↔Users join pattern
description: How to join workers and users tables — workers has no user_id column; the FK lives on users.
---

## Rule
`workers` has **no `user_id` column**. The relationship is:

```
users.worker_id  →  workers.id
```

## How to apply

To find users who are workers in a given company:
```sql
SELECT id FROM users
WHERE worker_id IN (SELECT id FROM workers WHERE company_id = $1)
```

To find the company for a given user (when user.companyId is null):
```sql
SELECT w.company_id FROM workers w
WHERE w.id = $user_worker_id   -- users.worker_id value
LIMIT 1
```
Or via the Drizzle User object: `user.workerId` (camelCase) maps to `users.worker_id`.

**Why:** Confusion with this caused a `column "user_id" does not exist` 500 error in the feedback GET endpoint when trying `SELECT user_id FROM workers WHERE company_id = …`.

**Where this applies:** Any query that needs to cross between users and workers — feedback visibility subqueries, notification routing, report scoping, etc.
