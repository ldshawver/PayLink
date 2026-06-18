/**
 * Safe Documenso environment verification.
 *
 * This script intentionally never prints secret values. It only reports whether
 * required settings are present and whether the base URL parses as a URL.
 */

const required = [
  "MYPAYLINK_DOCUMENSO_API_KEY",
  "MYPAYLINK_DOCUMENSO_BASE_URL",
  "MYPAYLINK_DOCUMENSO_ENABLED",
] as const;

let hasFailure = false;

for (const key of required) {
  const value = process.env[key]?.trim();
  if (!value) {
    hasFailure = true;
    console.error(`${key}: MISSING`);
  } else {
    console.log(`${key}: PRESENT`);
  }
}

const baseUrl = process.env.MYPAYLINK_DOCUMENSO_BASE_URL?.trim();
if (baseUrl) {
  try {
    const parsed = new URL(baseUrl);
    console.log(`MYPAYLINK_DOCUMENSO_BASE_URL_HOST: ${parsed.host}`);
  } catch {
    hasFailure = true;
    console.error("MYPAYLINK_DOCUMENSO_BASE_URL: INVALID_URL");
  }
}

const enabled = process.env.MYPAYLINK_DOCUMENSO_ENABLED?.trim().toLowerCase();
if (enabled && !["true", "false", "1", "0", "yes", "no"].includes(enabled)) {
  hasFailure = true;
  console.error("MYPAYLINK_DOCUMENSO_ENABLED: INVALID_BOOLEAN");
}

if (hasFailure) {
  console.error("Documenso environment verification failed.");
  process.exit(1);
}

console.log("Documenso environment verification passed without exposing secrets.");
