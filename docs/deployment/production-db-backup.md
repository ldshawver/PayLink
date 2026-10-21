# Production database backup and recovery (PB-1)

**Scope:** the PayLink production PostgreSQL database (`DATABASE_URL` in
`/etc/paylink/.env`, cluster `16/main` on 127.0.0.1:5432 of the production VPS).

## 0. What existed before PB-1 (audit 2026-10-21)

| Item | Finding | Classification |
|---|---|---|
| CloudPanel `clpctl db:backup` (cron 03:15) | Backs up **MySQL** databases only | Existing and working, but does not protect PayLink |
| CloudPanel `create_backup.sh` (cron 04:15) | Backs up CloudPanel's own SQLite + files | Existing and working, but does not protect PayLink |
| `scripts/backup-db.sh` (old) | Never scheduled. There was no cron or timer entry and no log file, and the only output was 2 manual runs on 2026-06-12. It read `SMTP_PASS`, but prod uses `SMTP_PASSWORD`, so its alerts could never send. It also had no encryption, no off-server copy and no restore test | Existing but defective |
| `DISASTER_RECOVERY.md` §3 | Stated that a nightly cron was installed. It was not | Operational risk (false assurance) |
| Deploy-time dump (`deploy-production.yml`) | Taken only when a release is deployed, checked for completion and sha256-verified (PR #171). Stored on the same host, unencrypted | Existing and working, not a schedule |
| Off-server copy | None. rclone is installed but has no remote configured | Missing (**security + operational risk**) |
| Restore testing | Ad hoc only (release rehearsals) | Missing |

## 1. Design

`paylink-db-backup.timer` runs nightly at 03:40 UTC as `paylinkssh`. Its
service runs `/usr/local/lib/paylink-backup/backup-db.sh`, which is a
root-owned copy, so an app deploy can't change or break the backup job. Each
run does the following:

1. Runs `pg_dump --format=custom` into a private `0700` work dir. The password is
   passed through a `0600` pgpass file and never appears on argv.
2. Runs `pg_restore --list`, which must show at least `PAYLINK_BACKUP_MIN_TABLES` tables.
3. **Restore drill:** `backup-restore-verify.sh` restores the dump into a
   throwaway `initdb` cluster that listens on a unix socket only (no TCP). It
   checks that the restored table count equals the TOC, and that `companies`,
   `users` and `workers` are non-empty. A backup that can't be restored counts
   as a failure.
4. Encrypts the dump with `gpg` to the **public** key of an offline-held backup
   key, then deletes the plaintext dump.
5. Writes `.sha256` and a `.manifest.txt` file. The manifest holds the versions,
   hashes, restore-drill result and per-table row counts, but no credentials.
6. Keeps the encrypted copy in `/var/backups/paylink/nightly/`.
7. Runs `rclone copyto` to the off-server bucket under `prod/YYYY/MM/`, then
   **reads the object back** and compares its sha256.
8. Retention:
   - Local copies older than `PAYLINK_BACKUP_LOCAL_RETAIN_DAYS` are deleted
     (default 14). Only `paylink-prod-*` files are touched; pre-deploy dumps
     never are.
   - Remote retention is handled by bucket lifecycle rules (recommended). As an
     alternative, the script prunes the remote when `PAYLINK_BACKUP_REMOTE_RETAIN_DAYS`
     is set (must be 7 or more).
9. Writes the `last-success` marker, then sends the healthcheck success ping.

Every failure pings `<healthcheck>/fail` and emails `PAYLINK_BACKUP_ALERT_EMAIL`
(using the app's `SMTP_*`). Every failure also names the stage that failed and
exits non-zero, which systemd records as a failed unit. Because the healthcheck
is a dead-man switch, it **also alerts when the timer never runs**.

**Security properties**

- The server can encrypt but **can't decrypt**. A server compromise or a leaked
  bucket credential doesn't expose past backups.
- The bucket credential should be write+read+list only, with no delete. Retention
  then lives in bucket lifecycle, so ransomware on the host can't wipe the
  off-site history. Enable object lock or versioning if the provider supports it.
- The DB credential defaults to the app's own login. Least privilege
  (recommended, but it is a production DB change that needs separate approval)
  is a dedicated role:
  ```sql
  CREATE ROLE paylink_backup LOGIN PASSWORD '<generated>';
  GRANT pg_read_all_data TO paylink_backup;
  GRANT CONNECT ON DATABASE <prod db> TO paylink_backup;
  ```
  Then set `PAYLINK_BACKUP_DATABASE_URL` in `backup.env`, and make that file
  `0600 paylinkssh`.

## 2. Offline key (one-time, on an admin machine — NOT the VPS)

```bash
gpg --quick-gen-key 'PayLink Prod DB Backup <ops@mypaylink.app>' rsa4096 encrypt 5y
gpg --list-keys --with-colons 'PayLink Prod DB Backup' | awk -F: '$1=="fpr"{print $10; exit}'   # fingerprint
gpg --export --armor <FPR> > paylink-backup-public.asc            # goes to the server
gpg --export-secret-keys --armor <FPR> > paylink-backup-SECRET.asc  # NEVER to the server
```

Store the secret key (and its passphrase) in **two** places that don't share a
failure mode, for example a password manager plus a printed or USB copy in a
safe. If that key is lost, every backup is unrecoverable.

## 3. Install (production VPS, as root — requires deployment approval)

```bash
# 3.1 scripts (root-owned, not writable by the app user)
install -d -m 0755 /usr/local/lib/paylink-backup
install -m 0755 scripts/backup-db.sh scripts/backup-restore-verify.sh /usr/local/lib/paylink-backup/

# 3.2 directories
install -d -o paylinkssh -g mypaylink-app -m 0700 /var/backups/paylink/nightly
install -d -o paylinkssh -g mypaylink-app -m 0700 /home/paylinkssh/.paylink-backup-gnupg

# 3.3 public key only
sudo -u paylinkssh GNUPGHOME=/home/paylinkssh/.paylink-backup-gnupg gpg --import paylink-backup-public.asc
sudo -u paylinkssh GNUPGHOME=/home/paylinkssh/.paylink-backup-gnupg gpg --list-secret-keys   # must print nothing

# 3.4 off-server remote (bucket in a different provider/region than this VPS)
sudo -u paylinkssh rclone config      # remote name: paylink-offsite; scoped key: list/read/write, no delete
chmod 600 /home/paylinkssh/.config/rclone/rclone.conf

# 3.5 config
install -o root -g mypaylink-app -m 0640 scripts/backup/backup.env.example /etc/paylink/backup.env
$EDITOR /etc/paylink/backup.env      # fingerprint, remote, healthcheck URL, alert email

# 3.6 first run by hand, then enable the timer
install -m 0644 scripts/backup/systemd/paylink-db-backup.service scripts/backup/systemd/paylink-db-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl start paylink-db-backup.service && journalctl -u paylink-db-backup.service -n 50 --no-pager
systemctl enable --now paylink-db-backup.timer
systemctl list-timers paylink-db-backup.timer
```

Healthcheck: create a check with period 1 day and grace 2 hours (for example on
healthchecks.io), and route its alerts to email or SMS that someone reads.

Upgrades: re-run step 3.1 from the reviewed release. App deploys don't change
the installed copy.

## 4. Daily operation

```bash
systemctl list-timers paylink-db-backup.timer
cat /var/backups/paylink/nightly/last-success
journalctl -u paylink-db-backup.service --since '1 day ago' --no-pager
sudo -u paylinkssh rclone lsl paylink-offsite:<bucket>/prod/$(date -u +%Y/%m)/
```

## 5. Restore procedure

Restore into a **new** database and switch to it. Never restore over the live
database in place: the old one is your fallback until the new one is verified.

On the admin machine (where the private key is):

```bash
rclone copy paylink-offsite:<bucket>/prod/YYYY/MM/paylink-prod-<TS>.dump.gpg .
rclone copy paylink-offsite:<bucket>/prod/YYYY/MM/paylink-prod-<TS>.dump.gpg.sha256 .
sha256sum -c paylink-prod-<TS>.dump.gpg.sha256
gpg --decrypt --output paylink-prod-<TS>.dump paylink-prod-<TS>.dump.gpg
pg_restore --list paylink-prod-<TS>.dump | head        # sanity
```

Copy the plaintext `.dump` to the target host over SSH, then on that host:

```bash
pm2 stop paylink                                        # stop writers (prod app)
createdb -O <app_role> paylink_restore_<TS>
pg_restore --exit-on-error --no-owner --role=<app_role> -d paylink_restore_<TS> paylink-prod-<TS>.dump
# verify: compare row counts with the manifest's "--- row counts ---" section
psql -d paylink_restore_<TS> -c "SELECT count(*) FROM companies; SELECT count(*) FROM users; SELECT count(*) FROM workers;"
# cut over: point DATABASE_URL in /etc/paylink/.env at paylink_restore_<TS>
#           (or rename: ALTER DATABASE <live> RENAME TO <live>_old_<TS>; ALTER DATABASE paylink_restore_<TS> RENAME TO <live>;)
pm2 start paylink && curl -s https://mypaylink.app/api/version
shred -u paylink-prod-<TS>.dump                         # remove the plaintext copy
```

Keep the old database until the restored one has been accepted. The pre-deploy
dumps in `/home/paylinkssh/paylink-predeploy-backups/` (plain SQL, gzip) remain
a second recovery source. They restore with `gunzip -c … | psql -d paylink_restore_<TS>`.

## 6. Restore drills

- **Nightly (automatic):** every backup is restored into a throwaway cluster
  before it is accepted. The result is recorded in its manifest.
- **Quarterly (manual, end to end with the off-site copy and the offline key),
  on the admin machine:**
  ```bash
  rclone copy paylink-offsite:<bucket>/prod/YYYY/MM/paylink-prod-<TS>.dump.gpg .
  scripts/backup-restore-verify.sh --min-tables 150 --require-rows "companies users workers" \
    --report drill.txt paylink-prod-<TS>.dump.gpg     # decrypts with your keyring
  diff <(sed -n '/--- row counts ---/,$p' drill.txt) <(sed -n '/--- row counts ---/,$p' paylink-prod-<TS>.manifest.txt)
  ```
  Record the date, the backup used, PASS or FAIL and the elapsed time in
  `DISASTER_RECOVERY.md` §8.

## 7. Tests

- `tests/backup-db-static.test.ts` (in the required suite) pins the safety contract.
- `tests/backup-db-pipeline.test.ts` (CI job `backup-pipeline`) runs the real
  scripts against a throwaway cluster, a temporary GPG key pair, an rclone
  `local` remote and a ping listener. It covers:
  - the success path, plus restore of the off-server copy
  - wrong DB password, missing or unknown key, unreachable remote
  - the table floor, an empty required table and a truncated dump
  - local and remote retention
