-- Recovery: re-insert rows from a cleanup-seed-duplicate-hierarchy.ts --backup-file (JSONL).
-- Usage: psql "$DATABASE_URL" -v backup=/path/rows.jsonl -f restore-from-backup.sql
BEGIN;
CREATE TEMP TABLE _restore (line jsonb);
\set cmd '\\copy _restore (line) FROM ' :'backup' ' WITH (FORMAT csv, QUOTE E''\\x01'', DELIMITER E''\\x02'')'
:cmd
INSERT INTO departments    SELECT (jsonb_populate_record(NULL::departments,    line->'row')).* FROM _restore WHERE line->>'table' = 'departments'    ON CONFLICT (id) DO NOTHING;
INSERT INTO legal_entities SELECT (jsonb_populate_record(NULL::legal_entities, line->'row')).* FROM _restore WHERE line->>'table' = 'legal_entities' ON CONFLICT (id) DO NOTHING;
SELECT line->>'table' AS t, count(*) FROM _restore GROUP BY 1;
COMMIT;
