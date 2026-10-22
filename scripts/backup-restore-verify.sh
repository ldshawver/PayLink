#!/usr/bin/env bash
# PayLink — non-destructive restore drill.
#
# Restores a pg_dump custom-format backup into a THROWAWAY PostgreSQL cluster
# (fresh initdb in a private temp dir, unix-socket only, no TCP listener), then
# checks it. It never connects to, or modifies, any existing database.
#
# Usage:
#   backup-restore-verify.sh [--min-tables N] [--require-rows "t1 t2"] [--report FILE] BACKUP
#
#   BACKUP  a .dump file, or a .dump.gpg file (decrypted with the caller's GPG
#           keyring — only possible where the offline private key is available)
#
# Checks:
#   - pg_restore --exit-on-error succeeds (every DDL statement and COPY block loads)
#   - restored table count == table count in the dump's TOC, and >= --min-tables
#   - every table named in --require-rows has at least one row
# Writes per-table row counts to --report (stdout if omitted).
#
# Must not run as root (initdb refuses). Set PAYLINK_PG_BINDIR to choose the
# PostgreSQL server binaries; defaults to the newest /usr/lib/postgresql/*/bin.

set -euo pipefail
umask 077

MIN_TABLES=1
REQUIRE_ROWS=""
REPORT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --min-tables) MIN_TABLES="$2"; shift 2 ;;
    --require-rows) REQUIRE_ROWS="$2"; shift 2 ;;
    --report) REPORT="$2"; shift 2 ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    --) shift; break ;;
    -*) echo "unknown option: $1" >&2; exit 2 ;;
    *) break ;;
  esac
done
[ $# -eq 1 ] || { echo "usage: $0 [--min-tables N] [--require-rows \"t1 t2\"] [--report FILE] BACKUP" >&2; exit 2; }
BACKUP="$1"
[ -r "$BACKUP" ] || { echo "backup not readable: $BACKUP" >&2; exit 2; }
[ "$(id -u)" -ne 0 ] || { echo "refusing to run as root (initdb requires an unprivileged user)" >&2; exit 2; }

log() { echo "[restore-verify] $*"; }

BINDIR="${PAYLINK_PG_BINDIR:-}"
if [ -z "$BINDIR" ]; then
  BINDIR="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -n 1 || true)"
fi
for b in initdb pg_ctl pg_restore psql; do
  [ -x "$BINDIR/$b" ] || { echo "PostgreSQL binary not found: $BINDIR/$b (set PAYLINK_PG_BINDIR)" >&2; exit 2; }
done

TMP="$(mktemp -d "${TMPDIR:-/tmp}/paylink-restore-verify-XXXXXX")"
PGDATA_DIR="$TMP/data"
SOCK="$TMP/sock"
mkdir -p "$SOCK"
STARTED=0
cleanup() {
  if [ "$STARTED" = "1" ]; then
    "$BINDIR/pg_ctl" -D "$PGDATA_DIR" -m immediate -w stop >/dev/null 2>&1 || true
  fi
  rm -rf -- "$TMP"
}
trap cleanup EXIT

DUMP="$BACKUP"
if [[ "$BACKUP" == *.gpg ]]; then
  DUMP="$TMP/backup.dump"
  gpg --batch --quiet --decrypt --output "$DUMP" "$BACKUP" || { echo "gpg decryption failed" >&2; exit 1; }
  log "decrypted $(basename "$BACKUP")"
fi

"$BINDIR/pg_restore" --list "$DUMP" >"$TMP/toc.txt" || { echo "cannot read dump TOC" >&2; exit 1; }
TOC_TABLES="$(awk '$4 == "TABLE" && $5 != "DATA"' "$TMP/toc.txt" | wc -l)"

"$BINDIR/initdb" -D "$PGDATA_DIR" -U verify --auth=trust --encoding=UTF8 --locale=C.UTF-8 >"$TMP/initdb.log" 2>&1 \
  || { cat "$TMP/initdb.log" >&2; exit 1; }
# Socket-only: listen_addresses='' means no TCP port is opened at all.
"$BINDIR/pg_ctl" -D "$PGDATA_DIR" -w -l "$TMP/server.log" \
  -o "-c listen_addresses='' -c unix_socket_directories='$SOCK' -c port=55432 -c max_locks_per_transaction=1024 -c fsync=off -c full_page_writes=off" \
  start >/dev/null || { cat "$TMP/server.log" >&2; exit 1; }
STARTED=1

PSQL=("$BINDIR/psql" -X -q -v ON_ERROR_STOP=1 -h "$SOCK" -p 55432 -U verify)
"${PSQL[@]}" -d postgres -c "CREATE DATABASE restore_verify" >/dev/null

log "restoring into throwaway cluster ($TOC_TABLES tables in TOC)"
"$BINDIR/pg_restore" --exit-on-error --no-owner --no-privileges \
  -h "$SOCK" -p 55432 -U verify -d restore_verify "$DUMP" 2>"$TMP/restore.err" \
  || { sed 's/^/  pg_restore: /' "$TMP/restore.err" | tail -n 20 >&2; echo "restore FAILED" >&2; exit 1; }

COUNTS="$TMP/counts.txt"
"${PSQL[@]}" -d restore_verify -At -F ' ' >"$COUNTS" <<'SQL'
SELECT n.nspname || '.' || c.relname,
       (xpath('/row/c/text()',
              query_to_xml(format('SELECT count(*) AS c FROM %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_toast%'
ORDER BY 1;
SQL

RESTORED_TABLES="$(wc -l <"$COUNTS")"
TOTAL_ROWS="$(awk '{s += $2} END {print s + 0}' "$COUNTS")"
FAILED=0
if [ "$RESTORED_TABLES" -ne "$TOC_TABLES" ]; then
  echo "table count mismatch: TOC ${TOC_TABLES}, restored ${RESTORED_TABLES}" >&2; FAILED=1
fi
if [ "$RESTORED_TABLES" -lt "$MIN_TABLES" ]; then
  echo "restored ${RESTORED_TABLES} tables, below minimum ${MIN_TABLES}" >&2; FAILED=1
fi
for t in $REQUIRE_ROWS; do
  [[ "$t" == *.* ]] || t="public.$t"
  rows="$(awk -v t="$t" '$1 == t {print $2}' "$COUNTS")"
  if [ -z "$rows" ]; then
    echo "required table missing from restore: $t" >&2; FAILED=1
  elif [ "$rows" -lt 1 ]; then
    echo "required table is empty after restore: $t" >&2; FAILED=1
  fi
done

{
  echo "restore_drill=$([ "$FAILED" = 0 ] && echo PASS || echo FAIL)"
  echo "restored_tables=${RESTORED_TABLES}"
  echo "toc_tables=${TOC_TABLES}"
  echo "total_rows=${TOTAL_ROWS}"
  echo "required_nonempty=${REQUIRE_ROWS:-none}"
  echo "--- row counts ---"
  cat "$COUNTS"
} >"${REPORT:-/dev/stdout}"

if [ "$FAILED" -ne 0 ]; then
  echo "restore drill FAILED" >&2
  exit 1
fi
log "restore drill PASS: ${RESTORED_TABLES} tables, ${TOTAL_ROWS} rows"
