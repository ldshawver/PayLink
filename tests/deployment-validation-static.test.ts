import fs from "node:fs";
const staging = fs.readFileSync(".github/workflows/deploy-app.yml", "utf8");
const production = fs.readFileSync(".github/workflows/deploy-production.yml", "utf8");
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); console.log(`PASS: ${message}`); }
assert(staging.includes("Signing route regression tests") && staging.includes("pnpm typecheck") && staging.includes("pnpm build"), "staging workflow gates deployment on typecheck, tests, and build");
assert(staging.includes('PAYLINK_COMMIT="$NEW_COMMIT"') && staging.includes("PAYLINK_BUILD_TIME"), "staging workflow injects deployed commit and build time into PM2 process");
assert(production.includes("release_tag") && production.includes('PAYLINK_VERSION="$RELEASE_TAG"'), "production deploy pins and exposes an explicit release tag");
assert(production.includes('pg_dump "$DATABASE_URL"') && production.includes('test -s "$BACKUP_FILE"'), "production deploy verifies pg_dump backup before restart");
