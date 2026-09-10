/**
 * Safe Documenso environment verification.
 *
 * This script intentionally never prints secret values. It only reports whether
 * required settings are present and whether the base URL parses as a URL.
 */

const apiKeyCandidates = ["DOCUMENSO_API_KEY", "MYPAYLINK_DOCUMENSO_API_KEY", "MyPayLink_DOCUMENSO_API_KEY"] as const;
const baseUrlCandidates = ["DOCUMENSO_URL", "MYPAYLINK_DOCUMENSO_BASE_URL", "DOCUMENSO_BASE_URL"] as const;
const webhookUrlCandidates = ["DOCUMENSO_WEBHOOK", "DOCUMENSO_WEBHOOK_URL", "MYPAYLINK_DOCUMENSO_WEBHOOK_URL"] as const;
const webhookSecretCandidates = ["DOCUMENSO_WEBHOOK_SECRET", "MYPAYLINK_DOCUMENSO_WEBHOOK_SECRET"] as const;

// The Documenso instance must be told to POST completion events to exactly this path.
// Pull-sync (server reconcile loop + admin "Refresh status") covers gaps, but timely
// updates depend on the webhook landing here.
const EXPECTED_WEBHOOK_PATH = "/api/webhooks/documenso";

let hasFailure = false;

const reportFirstPresent = (label: string, keys: readonly string[]) => {
  const key = keys.find((candidate) => process.env[candidate]?.trim());
  if (!key) {
    hasFailure = true;
    console.error(`${label}: MISSING (${keys.join(" or ")})`);
    return null;
  }
  console.log(`${key}: PRESENT`);
  return key;
};

reportFirstPresent("DOCUMENSO_API_KEY", apiKeyCandidates);
const baseUrlKey = reportFirstPresent("DOCUMENSO_URL", baseUrlCandidates);
const webhookUrlKey = reportFirstPresent("DOCUMENSO_WEBHOOK", webhookUrlCandidates);
reportFirstPresent("DOCUMENSO_WEBHOOK_SECRET", webhookSecretCandidates);

const baseUrl = baseUrlKey ? process.env[baseUrlKey]?.trim() : undefined;
if (baseUrl) {
  try {
    const parsed = new URL(baseUrl);
    console.log(`${baseUrlKey}_HOST: ${parsed.host}`);
  } catch {
    hasFailure = true;
    console.error(`${baseUrlKey}: INVALID_URL`);
  }
}

const webhookUrl = webhookUrlKey ? process.env[webhookUrlKey]?.trim() : undefined;
if (webhookUrl) {
  try {
    const parsed = new URL(webhookUrl);
    console.log(`${webhookUrlKey}_HOST: ${parsed.host}`);
    if (parsed.pathname !== EXPECTED_WEBHOOK_PATH) {
      console.error(`${webhookUrlKey}: UNEXPECTED_PATH (${parsed.pathname}; expected ${EXPECTED_WEBHOOK_PATH})`);
    }
  } catch {
    hasFailure = true;
    console.error(`${webhookUrlKey}: INVALID_URL`);
  }
}

const enabled = (process.env.DOCUMENSO_ENABLED || process.env.MYPAYLINK_DOCUMENSO_ENABLED)?.trim().toLowerCase();
if (enabled && !["true", "false", "1", "0", "yes", "no"].includes(enabled)) {
  hasFailure = true;
  console.error("DOCUMENSO_ENABLED: INVALID_BOOLEAN");
}

if (hasFailure) {
  console.error("Documenso environment verification failed.");
  process.exit(1);
}

console.log("Documenso environment verification passed without exposing secrets.");
