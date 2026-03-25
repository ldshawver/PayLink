#!/bin/bash
# ──────────────────────────────────────────────────────────────────────
# Migrate workers/employees from old paylink DB to apppaylinkmain DB
# Run on VPS as: bash scripts/migrate-workers-to-new-db.sh
# ──────────────────────────────────────────────────────────────────────

set -e

OLD_DB="paylink"
NEW_DB="apppaylinkmain"
DB_USER="lshawver"
DB_HOST="127.0.0.1"

echo "═══════════════════════════════════════════════════════"
echo "  PayLink Worker Migration: $OLD_DB → $NEW_DB"
echo "═══════════════════════════════════════════════════════"

# Step 0: Backup the new database first
echo ""
echo "Step 0: Backing up $NEW_DB..."
mkdir -p ~/backups
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
pg_dump -U $DB_USER -h $DB_HOST $NEW_DB > ~/backups/${NEW_DB}_backup_${TIMESTAMP}.sql
echo "  ✓ Backup saved to ~/backups/${NEW_DB}_backup_${TIMESTAMP}.sql"

# Step 1: Check what's in the old database
echo ""
echo "Step 1: Checking old database..."
OLD_WORKER_COUNT=$(psql -U $DB_USER -h $DB_HOST -d $OLD_DB -t -c "SELECT count(*) FROM workers;" 2>/dev/null | tr -d ' ')
OLD_COMPANY_COUNT=$(psql -U $DB_USER -h $DB_HOST -d $OLD_DB -t -c "SELECT count(*) FROM companies;" 2>/dev/null | tr -d ' ')
echo "  Old DB has $OLD_WORKER_COUNT workers and $OLD_COMPANY_COUNT companies"

NEW_WORKER_COUNT=$(psql -U $DB_USER -h $DB_HOST -d $NEW_DB -t -c "SELECT count(*) FROM workers;" 2>/dev/null | tr -d ' ')
NEW_COMPANY_COUNT=$(psql -U $DB_USER -h $DB_HOST -d $NEW_DB -t -c "SELECT count(*) FROM companies;" 2>/dev/null | tr -d ' ')
echo "  New DB has $NEW_WORKER_COUNT workers and $NEW_COMPANY_COUNT companies"

# Step 2: Check old DB columns to handle schema differences
echo ""
echo "Step 2: Checking schema compatibility..."
OLD_COLS=$(psql -U $DB_USER -h $DB_HOST -d $OLD_DB -t -c "
  SELECT string_agg(column_name, ',') 
  FROM information_schema.columns 
  WHERE table_name = 'workers' AND table_schema = 'public';
" | tr -d ' ')
echo "  Old worker columns detected"

# Step 3: Ensure enum types exist in new DB
echo ""
echo "Step 3: Ensuring enum types exist in new DB..."
psql -U $DB_USER -h $DB_HOST -d $NEW_DB -c "
  DO \$\$ BEGIN
    CREATE TYPE worker_type AS ENUM ('employee', 'contractor');
  EXCEPTION WHEN duplicate_object THEN NULL;
  END \$\$;
  DO \$\$ BEGIN
    CREATE TYPE worker_status AS ENUM ('active', 'inactive', 'terminated', 'on_leave', 'suspended');
  EXCEPTION WHEN duplicate_object THEN NULL;
  END \$\$;
  DO \$\$ BEGIN
    CREATE TYPE gender AS ENUM ('male', 'female', 'non_binary', 'unspecified');
  EXCEPTION WHEN duplicate_object THEN NULL;
  END \$\$;
" 2>/dev/null
echo "  ✓ Enum types verified"

# Step 4: Migrate companies first (workers reference them)
echo ""
echo "Step 4: Migrating companies (skip existing)..."
psql -U $DB_USER -h $DB_HOST -d $OLD_DB -c "
  COPY (SELECT * FROM companies WHERE id NOT IN (
    SELECT id FROM dblink('dbname=$NEW_DB user=$DB_USER host=$DB_HOST', 'SELECT id FROM companies') AS t(id varchar)
  )) TO STDOUT WITH CSV HEADER;
" 2>/dev/null | psql -U $DB_USER -h $DB_HOST -d $NEW_DB -c "
  COPY companies FROM STDIN WITH CSV HEADER;
" 2>/dev/null || {
  echo "  Note: dblink not available, using alternate method..."
  
  # Export from old, import to new (skip duplicates)
  psql -U $DB_USER -h $DB_HOST -d $OLD_DB -c "\COPY companies TO '/tmp/paylink_companies.csv' WITH CSV HEADER;"
  
  # Create temp table, load, then insert missing
  psql -U $DB_USER -h $DB_HOST -d $NEW_DB <<'EOSQL'
    CREATE TEMP TABLE tmp_companies (LIKE companies INCLUDING ALL);
    \COPY tmp_companies FROM '/tmp/paylink_companies.csv' WITH CSV HEADER;
    INSERT INTO companies 
    SELECT tc.* FROM tmp_companies tc 
    WHERE NOT EXISTS (SELECT 1 FROM companies c WHERE c.id = tc.id)
    ON CONFLICT (id) DO NOTHING;
    DROP TABLE tmp_companies;
EOSQL
}
NEW_COMPANY_COUNT2=$(psql -U $DB_USER -h $DB_HOST -d $NEW_DB -t -c "SELECT count(*) FROM companies;" | tr -d ' ')
echo "  ✓ Companies in new DB: $NEW_COMPANY_COUNT2"

# Step 5: Migrate workers
echo ""
echo "Step 5: Migrating workers (skip existing)..."

# Find common columns between old and new
NEW_COLS=$(psql -U $DB_USER -h $DB_HOST -d $NEW_DB -t -c "
  SELECT string_agg(column_name, ',' ORDER BY ordinal_position) 
  FROM information_schema.columns 
  WHERE table_name = 'workers' AND table_schema = 'public';
" | tr -d ' ')

OLD_COLS_LIST=$(psql -U $DB_USER -h $DB_HOST -d $OLD_DB -t -c "
  SELECT string_agg(column_name, ',' ORDER BY ordinal_position) 
  FROM information_schema.columns 
  WHERE table_name = 'workers' AND table_schema = 'public';
" | tr -d ' ')

echo "  Finding common columns..."

# Use Python to find intersection of columns (preserving order from new DB)
COMMON_COLS=$(python3 -c "
old = set('$OLD_COLS_LIST'.split(','))
new = '$NEW_COLS'.split(',')
common = [c for c in new if c in old]
print(','.join(common))
")
echo "  Common columns: $COMMON_COLS"

# Export workers from old DB using common columns only
psql -U $DB_USER -h $DB_HOST -d $OLD_DB -c "\COPY (SELECT $COMMON_COLS FROM workers) TO '/tmp/paylink_workers.csv' WITH CSV HEADER;"

# Import into new DB
psql -U $DB_USER -h $DB_HOST -d $NEW_DB <<EOSQL
  CREATE TEMP TABLE tmp_workers AS SELECT * FROM workers WHERE 1=0;
  \COPY tmp_workers($COMMON_COLS) FROM '/tmp/paylink_workers.csv' WITH CSV HEADER;
  INSERT INTO workers($COMMON_COLS) 
  SELECT $COMMON_COLS FROM tmp_workers tw
  WHERE NOT EXISTS (SELECT 1 FROM workers w WHERE w.id = tw.id)
  ON CONFLICT (id) DO NOTHING;
  DROP TABLE tmp_workers;
EOSQL

NEW_WORKER_COUNT2=$(psql -U $DB_USER -h $DB_HOST -d $NEW_DB -t -c "SELECT count(*) FROM workers;" | tr -d ' ')
echo "  ✓ Workers in new DB: $NEW_WORKER_COUNT2 (was $NEW_WORKER_COUNT)"

# Step 6: Migrate related employee tables
echo ""
echo "Step 6: Migrating related employee data..."

for TABLE in employee_contacts pay_methods wage_history worker_documents worker_languages worker_memberships; do
  OLD_EXISTS=$(psql -U $DB_USER -h $DB_HOST -d $OLD_DB -t -c "
    SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = '$TABLE' AND table_schema = 'public');
  " | tr -d ' ')
  
  NEW_EXISTS=$(psql -U $DB_USER -h $DB_HOST -d $NEW_DB -t -c "
    SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = '$TABLE' AND table_schema = 'public');
  " | tr -d ' ')
  
  if [ "$OLD_EXISTS" = "t" ] && [ "$NEW_EXISTS" = "t" ]; then
    OLD_COUNT=$(psql -U $DB_USER -h $DB_HOST -d $OLD_DB -t -c "SELECT count(*) FROM $TABLE;" | tr -d ' ')
    
    if [ "$OLD_COUNT" -gt "0" ]; then
      # Find common columns
      T_NEW_COLS=$(psql -U $DB_USER -h $DB_HOST -d $NEW_DB -t -c "
        SELECT string_agg(column_name, ',' ORDER BY ordinal_position) 
        FROM information_schema.columns WHERE table_name = '$TABLE' AND table_schema = 'public';
      " | tr -d ' ')
      
      T_OLD_COLS=$(psql -U $DB_USER -h $DB_HOST -d $OLD_DB -t -c "
        SELECT string_agg(column_name, ',' ORDER BY ordinal_position) 
        FROM information_schema.columns WHERE table_name = '$TABLE' AND table_schema = 'public';
      " | tr -d ' ')
      
      T_COMMON=$(python3 -c "
old = set('$T_OLD_COLS'.split(','))
new = '$T_NEW_COLS'.split(',')
common = [c for c in new if c in old]
print(','.join(common))
")
      
      psql -U $DB_USER -h $DB_HOST -d $OLD_DB -c "\COPY (SELECT $T_COMMON FROM $TABLE) TO '/tmp/paylink_${TABLE}.csv' WITH CSV HEADER;"
      
      psql -U $DB_USER -h $DB_HOST -d $NEW_DB <<EOSQL
        CREATE TEMP TABLE tmp_${TABLE} AS SELECT * FROM $TABLE WHERE 1=0;
        \COPY tmp_${TABLE}($T_COMMON) FROM '/tmp/paylink_${TABLE}.csv' WITH CSV HEADER;
        INSERT INTO ${TABLE}($T_COMMON) 
        SELECT $T_COMMON FROM tmp_${TABLE} t
        WHERE NOT EXISTS (SELECT 1 FROM ${TABLE} x WHERE x.id = t.id)
        ON CONFLICT (id) DO NOTHING;
        DROP TABLE tmp_${TABLE};
EOSQL
      
      NEW_COUNT=$(psql -U $DB_USER -h $DB_HOST -d $NEW_DB -t -c "SELECT count(*) FROM $TABLE;" | tr -d ' ')
      echo "  ✓ $TABLE: $OLD_COUNT in old → $NEW_COUNT in new"
    else
      echo "  - $TABLE: empty in old DB, skipping"
    fi
  else
    echo "  - $TABLE: table missing in old ($OLD_EXISTS) or new ($NEW_EXISTS), skipping"
  fi
done

# Step 7: Migrate users (linked to workers)
echo ""
echo "Step 7: Migrating user accounts..."
OLD_USER_COUNT=$(psql -U $DB_USER -h $DB_HOST -d $OLD_DB -t -c "SELECT count(*) FROM users;" | tr -d ' ')

U_NEW_COLS=$(psql -U $DB_USER -h $DB_HOST -d $NEW_DB -t -c "
  SELECT string_agg(column_name, ',' ORDER BY ordinal_position) 
  FROM information_schema.columns WHERE table_name = 'users' AND table_schema = 'public';
" | tr -d ' ')

U_OLD_COLS=$(psql -U $DB_USER -h $DB_HOST -d $OLD_DB -t -c "
  SELECT string_agg(column_name, ',' ORDER BY ordinal_position) 
  FROM information_schema.columns WHERE table_name = 'users' AND table_schema = 'public';
" | tr -d ' ')

U_COMMON=$(python3 -c "
old = set('$U_OLD_COLS'.split(','))
new = '$U_NEW_COLS'.split(',')
common = [c for c in new if c in old]
print(','.join(common))
")

psql -U $DB_USER -h $DB_HOST -d $OLD_DB -c "\COPY (SELECT $U_COMMON FROM users) TO '/tmp/paylink_users.csv' WITH CSV HEADER;"

psql -U $DB_USER -h $DB_HOST -d $NEW_DB <<EOSQL
  CREATE TEMP TABLE tmp_users AS SELECT * FROM users WHERE 1=0;
  \COPY tmp_users($U_COMMON) FROM '/tmp/paylink_users.csv' WITH CSV HEADER;
  INSERT INTO users($U_COMMON) 
  SELECT $U_COMMON FROM tmp_users t
  WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = t.id)
  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.username = t.username)
  ON CONFLICT (id) DO NOTHING;
  DROP TABLE tmp_users;
EOSQL

NEW_USER_COUNT=$(psql -U $DB_USER -h $DB_HOST -d $NEW_DB -t -c "SELECT count(*) FROM users;" | tr -d ' ')
echo "  ✓ Users: $OLD_USER_COUNT in old → $NEW_USER_COUNT in new"

# Step 8: Summary
echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Migration Complete!"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "  Companies: $(psql -U $DB_USER -h $DB_HOST -d $NEW_DB -t -c 'SELECT count(*) FROM companies;' | tr -d ' ')"
echo "  Workers:   $(psql -U $DB_USER -h $DB_HOST -d $NEW_DB -t -c 'SELECT count(*) FROM workers;' | tr -d ' ')"
echo "  Users:     $(psql -U $DB_USER -h $DB_HOST -d $NEW_DB -t -c 'SELECT count(*) FROM users;' | tr -d ' ')"
echo ""
echo "  Backup at: ~/backups/${NEW_DB}_backup_${TIMESTAMP}.sql"
echo ""
echo "  Next: Restart the app with 'pm2 restart paylink'"
echo ""

# Cleanup temp files
rm -f /tmp/paylink_companies.csv /tmp/paylink_workers.csv /tmp/paylink_users.csv
rm -f /tmp/paylink_employee_contacts.csv /tmp/paylink_pay_methods.csv
rm -f /tmp/paylink_wage_history.csv /tmp/paylink_worker_documents.csv
rm -f /tmp/paylink_worker_languages.csv /tmp/paylink_worker_memberships.csv
