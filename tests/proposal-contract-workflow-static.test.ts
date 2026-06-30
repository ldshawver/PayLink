import assert from "node:assert/strict";
import fs from "node:fs";

const routes = fs.readFileSync("server/routes.ts", "utf8");
const hub = fs.readFileSync("client/src/pages/contractor-hub.tsx", "utf8");

assert(routes.includes('app.post("/api/contractor-proposals/:id/repair-contract"'), "single proposal repair endpoint exists");
assert(routes.includes('SELECT * FROM contractor_contracts WHERE proposal_id = ${prop.id} ORDER BY created_at ASC LIMIT 1'), "convert-to-contract reuses existing proposal contract");
assert(routes.includes('A contract already exists for this proposal'), "manual contract creation prevents duplicate proposal contracts");
assert(routes.includes('workflow_contract_id') && routes.includes('workflow_invoice_count') && routes.includes('workflow_stage'), "proposal listing exposes workflow diagnostics");
assert(routes.includes("contract_repaired") && routes.includes("repair_contract_create"), "repair records workflow event and audit log");
assert(hub.includes('data-testid="panel-proposal-workflow-diagnostics"'), "proposal page renders workflow diagnostics");
assert(hub.includes('data-testid="btn-create-missing-contract"'), "proposal page exposes Create Missing Contract action");
assert(hub.includes('disabled={actionMutation.isPending || !proposalContractId}'), "proposal invoice action is gated by valid contract");
assert(hub.includes('converted_to_contract: { label: "Contract Created"'), "proposal status labels include Contract Created");

console.log("proposal-contract workflow static checks passed");
