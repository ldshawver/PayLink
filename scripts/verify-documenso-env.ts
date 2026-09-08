/**
 * Safe Documenso environment verification.
 *
 * This script intentionally never prints secret values. It only reports whether
 * required settings are present and whether the base URL parses as a URL.
 */

const apiKeyCandidates = ["DOCUMENSO_API_KEY", "MYPAYLINK_DOCUMENSO_API_KEY", "MyPayLink_DOCUMENSO_API_KEY"] as const;
const baseUrlCandidates = ["DOCUMENSO_URL", "MYPAYLINK_DOCUMENSO_BASE_URL", "DOCUMENSO_BASE_URL"] as const;

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
