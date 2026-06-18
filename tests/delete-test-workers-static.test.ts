import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const script = readFileSync('scripts/delete-test-workers.ts', 'utf8');

assert.match(script, /const execute = args\.has\('--execute'\)/, 'cleanup must default to dry-run unless --execute is present');
assert.match(script, /if \(!companyId\)/, 'company-id must be required');
assert.match(script, /execute && !backupFile/, 'backup must be required for execute');
assert.match(script, /NODE_ENV === 'production'/, 'production execution must be refused');
assert.match(script, /new Map\(REQUESTED_TARGET_WORKERS\.map/, 'requested duplicate names must be deduplicated internally');
assert.match(script, /BLOCKED: protected payroll, tax, signed document, invoice, check, or audit-related records were found/, 'protected financial/legal records must block execution');
assert.match(script, /--confirm-name-cleanup/, 'execute must require explicit cleanup confirmation');

console.log('delete-test-workers static guards passed');
