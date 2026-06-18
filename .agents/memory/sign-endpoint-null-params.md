---
name: Contract sign endpoint null-param fix
description: Two PostgreSQL "cannot determine data type" bugs fixed in the contract signing endpoint; patterns to watch for in similar endpoints.
---

## The rule
In Drizzle `sql` template literals, binding `null` as a standalone IS NOT NULL condition (e.g. `AND ${maybeNull} IS NOT NULL`) creates an untyped parameter PostgreSQL cannot resolve. Similarly, binding `null` in `UPDATE ... SET col = ${null}` where the column type is not obviously inferrable from a conditional expression can fail.

**Why:** PostgreSQL's extended-query protocol requires a type OID for every parameter. `IS NOT NULL` provides no column context, so type OID remains 0/unknown. This only surfaces at runtime when the value happens to be null — it won't appear in development if test data always has the field populated.

**How to apply:**
1. Never use `${jsVar} IS NOT NULL` inside a sql template — guard in JS instead: `jsVar ? sql\`... AND lower(email) = ${jsVar} ...\` : sql\`\``.
2. For conditional UPDATE of a nullable timestamp column, use two separate sql expressions: one that includes `col = NOW()` for the truthy branch and one that omits the column entirely for the falsy branch.
3. Same principle applies to any null-bound parameter that has no surrounding column/expression to infer its type from.
