import assert from "node:assert/strict";

type User = { role?: string | null; companyId?: string | null; workerId?: string | null };
type Doc = { company_id?: string | null; worker_id?: string | null };

function canReadDocumentHubAsset(user: User, doc: Doc): boolean {
  const role = user.role || "";
  const isPlatform = role.startsWith("platform_");
  const isAdmin = isPlatform || role.startsWith("tenant_") || role === "admin" || role === "manager";
  if (!isAdmin && doc.worker_id !== user.workerId) return false;
  if (isAdmin && !isPlatform && user.companyId && doc.company_id && doc.company_id !== user.companyId) return false;
  return true;
}

assert.equal(canReadDocumentHubAsset({ role: "admin", companyId: "co_a" }, { company_id: "co_a" }), true);
assert.equal(canReadDocumentHubAsset({ role: "admin", companyId: "co_a" }, { company_id: "co_b" }), false);
assert.equal(canReadDocumentHubAsset({ role: "platform_admin" }, { company_id: "co_b" }), true);
assert.equal(canReadDocumentHubAsset({ role: "contractor", workerId: "w1" }, { company_id: "co_a", worker_id: "w1" }), true);
assert.equal(canReadDocumentHubAsset({ role: "contractor", workerId: "w1" }, { company_id: "co_a", worker_id: "w2" }), false);

console.log("Document Hub tenant isolation tests passed");
