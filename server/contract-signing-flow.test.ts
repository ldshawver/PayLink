import assert from "node:assert/strict";
import {
  buildAuthenticatedContractSigningUrl,
  buildContractDocumensoReturnUrl,
  buildContractSigningUrl,
  canSignContract,
} from "./contract-signing-flow";

function run() {
  assert.equal(
    buildContractSigningUrl("https://mypaylink.app/", "tok+/="),
    "https://mypaylink.app/sign/contracts/tok%2B%2F%3D",
    "generated email signing URL must map to public token route",
  );

  assert.equal(
    buildAuthenticatedContractSigningUrl("https://mypaylink.app/", "contract 1"),
    "https://mypaylink.app/app/contractor-hub/contracts/contract%201/sign",
    "authenticated Contractor Hub signing URL must map to a real frontend route",
  );

  assert.equal(
    buildContractDocumensoReturnUrl("https://mypaylink.app/", "signer token 1"),
    "https://mypaylink.app/sign/contracts/signer%20token%201/status",
    "Documenso return URL should land on the public signing status route",
  );

  assert.equal(
    canSignContract({
      isContractor: false,
      isAdmin: false,
      isPlatformAdmin: false,
      userCompanyMatches: false,
      hasExplicitCompanyAccess: false,
      hasRegisteredSigner: true,
    }),
    true,
    "registered/token signer must be allowed without normal user_company_access",
  );

  assert.equal(
    canSignContract({
      isContractor: false,
      isAdmin: false,
      isPlatformAdmin: false,
      userCompanyMatches: false,
      hasExplicitCompanyAccess: false,
      hasRegisteredSigner: false,
    }),
    false,
    "unregistered non-company user must not be allowed to sign",
  );

  assert.equal(
    canSignContract({
      isContractor: false,
      isAdmin: true,
      isPlatformAdmin: false,
      userCompanyMatches: false,
      hasExplicitCompanyAccess: false,
      hasRegisteredSigner: false,
    }),
    false,
    "admin role alone must not bypass tenant/company scoping",
  );

  assert.equal(
    canSignContract({
      isContractor: false,
      isAdmin: true,
      isPlatformAdmin: false,
      userCompanyMatches: false,
      hasExplicitCompanyAccess: true,
      hasRegisteredSigner: false,
    }),
    true,
    "company admin with explicit company access can sign",
  );
}

run();
console.log("contract signing route/link and token authorization tests passed");
