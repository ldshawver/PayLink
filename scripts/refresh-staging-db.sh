#!/usr/bin/env bash
set -euo pipefail

PROD_DB_NAME="${PROD_DB_NAME:-mypaylink_prod}"
STAGING_DB_NAME="${STAGING_DB_NAME:-mypaylink_staging}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP_FILE="$BACKUP_DIR/${PROD_DB_NAME}_${STAMP}.dump"

if [[ "$STAGING_DB_NAME" != "mypaylink_staging" ]]; then
  echo "Refusing to restore: STAGING_DB_NAME must be mypaylink_staging, got '$STAGING_DB_NAME'" >&2
  exit 1
fi

if [[ "$PROD_DB_NAME" == "$STAGING_DB_NAME" ]]; then
  echo "Refusing to run: production and staging database names match." >&2
  exit 1
fi

if [[ "${CONFIRM_TARGET_DB:-}" != "$STAGING_DB_NAME" ]]; then
  echo "Set CONFIRM_TARGET_DB=$STAGING_DB_NAME to confirm the staging restore target." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
pg_dump --format=custom --no-owner --no-acl --dbname="$PROD_DB_NAME" --file="$DUMP_FILE"
pg_restore --clean --if-exists --no-owner --no-acl --dbname="$STAGING_DB_NAME" "$DUMP_FILE"

psql --dbname="$STAGING_DB_NAME" --set=ON_ERROR_STOP=1 <<'SQL'
-- Sanitization must remain non-destructive to production; this script only connects to staging above.
UPDATE users
SET email = CONCAT('staging+', id, '@example.invalid'),
    phone = NULL,
    password = CONCAT('STAGING_DISABLED_', id)
WHERE email NOT LIKE '%@example.invalid';

UPDATE companies
SET email = NULL,
    phone = NULL
WHERE TRUE;
SQL

echo "Staging refresh complete from $DUMP_FILE into $STAGING_DB_NAME"
