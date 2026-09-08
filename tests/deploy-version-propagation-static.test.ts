/**
 * Static regression checks for release-version reporting.
 * /api/version and /health read APP_VERSION and PAYLINK_COMMIT (server/app-metadata.ts).
 * Neither staging nor production previously set APP_VERSION, so both reported the
 * package.json default (2.1.1) regardless of the commit actually deployed.
 * Run: npx tsx tests/deploy-version-propagation-static.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";

const staging = fs.readFileSync(".github/workflows/deploy-app.yml", "utf8");
const production = fs.readFileSync(".github/workflows/deploy-production.yml", "utf8");
const script = fs.readFileSync("scripts/deploy-paylink.sh", "utf8");
const appMetadata = fs.readFileSync("server/app-metadata.ts", "utf8");

function ok(name: string, condition: boolean) {
  if (!condition) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}

ok(
  "app-metadata reads APP_VERSION for /api/version and /health, with a commit hash reported separately",
  appMetadata.includes('process.env.APP_VERSION') && appMetadata.includes("getCommitHash") && appMetadata.includes("process.env.PAYLINK_COMMIT"),
);

ok(
  "staging workflow computes PACKAGE_VERSION from package.json and starts PM2 with APP_VERSION set from it",
  staging.includes('PACKAGE_VERSION=$(node -p "require(\'./package.json\').version")') && staging.includes('APP_VERSION="$PACKAGE_VERSION"'),
);

ok(
  "staging still tags the exact deployed commit via PAYLINK_COMMIT (unchanged)",
  staging.includes('PAYLINK_COMMIT="$NEW_COMMIT"'),
);

ok(
  "production workflow computes PACKAGE_VERSION from the checked-out release, on the remote deploy path, before the PM2 restart",
  production.indexOf('PACKAGE_VERSION=$(node -p') > -1 &&
    production.indexOf('git checkout --force "$RELEASE_TAG"') < production.indexOf('PACKAGE_VERSION=$(node -p') &&
    production.indexOf('PACKAGE_VERSION=$(node -p') < production.indexOf('pm2 delete "$PM2_NAME"'),
);

ok(
  "production workflow rejects a release_tag that does not match package.json version",
  production.includes('EXPECTED_TAG="v$PACKAGE_VERSION"') &&
    /RELEASE_TAG"\s*!=\s*"\$EXPECTED_TAG"/.test(production) &&
    production.includes("exit 1"),
);

ok(
  "production's version-mismatch guard runs before the PM2 restart, not after",
  production.indexOf('EXPECTED_TAG="v$PACKAGE_VERSION"') < production.indexOf('pm2 delete "$PM2_NAME"'),
);

ok(
  "production workflow starts PM2 with APP_VERSION set from the validated package.json version",
  production.includes('APP_VERSION="$PACKAGE_VERSION"') &&
    production.indexOf('APP_VERSION="$PACKAGE_VERSION"') > production.indexOf('EXPECTED_TAG="v$PACKAGE_VERSION"'),
);

ok(
  "production still tags the exact deployed commit via PAYLINK_COMMIT (unchanged)",
  production.includes('PAYLINK_COMMIT="$NEW_COMMIT"'),
);

ok(
  "manual deploy script already validates release_tag against package.json version and sets APP_VERSION (pre-existing, confirmed unchanged by this pass)",
  script.includes('APP_VERSION_VALUE="${RELEASE_TAG#v}"') &&
    script.includes('"$RELEASE_TAG" != "$EXPECTED_TAG"') &&
    script.includes('APP_VERSION="$PACKAGE_VERSION"'),
);

console.log("\nDeploy version propagation checks passed.");
