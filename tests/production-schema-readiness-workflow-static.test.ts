import fs from "node:fs";
import assert from "node:assert/strict";

const workflow = fs.readFileSync(".github/workflows/apply-schema-readiness-production.yml", "utf8");

assert.match(workflow, /workflow_dispatch:/);
assert.match(workflow, /pg_dump "\$DATABASE_URL"/);
assert.match(workflow, /PostgreSQL database dump complete/);
assert.match(workflow, /gzip -t/);
assert.match(workflow, /0027_tenant_provisioning_audit_logs\.sql/);
assert.match(workflow, /0028_tenant_provisioning_gates_and_projects\.sql/);
assert.match(workflow, /test "\$BEFORE_COUNTS" = "\$AFTER_COUNTS"/);
assert.doesNotMatch(workflow, /\b(DROP|DELETE|TRUNCATE)\b/);

console.log("PASS: production schema-readiness workflow is backup-gated and additive-only");
