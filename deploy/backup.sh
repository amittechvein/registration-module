#!/bin/bash
# ============================================================================
# Registration DB backup — installed to /usr/local/bin/registration-backup
# by deploy/linode-setup.sh. Used by the nightly timer AND the pre-deploy
# snapshot so both share the same safety rules.
#
#   registration-backup <prefix> <keep>
#     prefix : "nightly" or "pre-deploy"
#     keep   : how many GOOD backups with that prefix to retain
#
# Rules (each one exists because it went wrong once):
#   - Refuses to run if PostgreSQL is not accepting connections.
#   - Dumps to a .tmp file; only a dump that finished cleanly AND is bigger
#     than MIN_BYTES is renamed into place. A dead database can never
#     produce a "successful" empty backup.
#   - Retention counts only real backups (> MIN_BYTES). Tiny/broken files
#     are deleted, never kept in place of good ones.
#   - On any failure: writes /opt/backups/LAST_FAILURE, emails every active
#     Owner via the app's own mailer, and exits non-zero (which aborts a
#     deploy — never deploy without a snapshot).
#
# Format is pg_dump custom (-Fc): compressed inside pg_dump (low memory on
# a 1 GB box), restorable with:
#   sudo -u postgres pg_restore -d registration --clean --if-exists --no-owner FILE.dump
# ============================================================================
set -u
PREFIX="${1:-nightly}"
KEEP="${2:-7}"
DIR=/opt/backups
DB=registration
MIN_BYTES=1000000            # 1 MB — the real DB is >100 MB compressed
STAMP=$(date +%Y%m%d-%H%M%S)
OUT="$DIR/${PREFIX}-${STAMP}.dump"
TMP="$OUT.tmp"
APP=/opt/registration/server

mkdir -p "$DIR"

fail() {
  local msg="$1"
  echo "BACKUP FAILED ($PREFIX): $msg" >&2
  echo "$(date -Is) $PREFIX: $msg" >> "$DIR/LAST_FAILURE"
  rm -f "$TMP"
  # Alert the Owners through the app's mailer (best effort — never blocks).
  if [ -f "$APP/alert.js" ]; then
    (cd "$APP" && timeout 60 node alert.js "URGENT: database backup FAILED on form.techvein.org" \
      "The $PREFIX backup at $(date -Is) failed: $msg

Free disk: $(df -h / | awk 'NR==2{print $4" of "$2" ("$5" used)"}')
Postgres: $(pg_isready -h 127.0.0.1 -p 5432 2>&1)

Check: ssh root@172.105.49.152 'cat /opt/backups/LAST_FAILURE; ls -lh /opt/backups'" \
      >/dev/null 2>&1) || true
  fi
  exit 1
}

# 1. Database must be up. (Sep 2026: Postgres was dead for 5 days and every
#    nightly "backup" was a 20-byte empty file nobody noticed.)
pg_isready -h 127.0.0.1 -p 5432 -q || fail "PostgreSQL is not accepting connections"

# 2. Enough free disk for one more dump (~2× the newest good one, min 1.5 GB).
LAST=$(ls -S "$DIR"/${PREFIX}-*.dump "$DIR"/nightly-*.dump 2>/dev/null | head -1)
NEED=$(( 1500 ))
if [ -n "${LAST:-}" ]; then
  LAST_MB=$(( $(stat -c%s "$LAST") / 1048576 ))
  [ $(( LAST_MB * 2 )) -gt $NEED ] && NEED=$(( LAST_MB * 2 ))
fi
FREE_MB=$(df -m / | awk 'NR==2{print $4}')
[ "$FREE_MB" -ge "$NEED" ] || fail "only ${FREE_MB} MB free on /, need ~${NEED} MB (prune /opt/backups or resize the disk)"

# 3. Dump. Custom format, compressed in-process (no gzip pipe = less RAM).
if ! sudo -u postgres pg_dump -Fc -Z 6 "$DB" > "$TMP"; then
  fail "pg_dump exited with an error"
fi
SIZE=$(stat -c%s "$TMP")
[ "$SIZE" -gt "$MIN_BYTES" ] || fail "dump is only $SIZE bytes — treated as broken"
# pg_restore -l parses the archive TOC: a truncated file fails here.
sudo -u postgres pg_restore -l "$TMP" >/dev/null 2>&1 || fail "dump failed pg_restore verification"
mv "$TMP" "$OUT"
rm -f "$DIR/LAST_FAILURE"
echo "OK  $OUT  ($(( SIZE / 1048576 )) MB)"

# 4. Retention — only real backups count; junk is removed outright.
find "$DIR" -maxdepth 1 -name "${PREFIX}-*" -type f -size -${MIN_BYTES}c -delete
ls -1t "$DIR"/${PREFIX}-*.dump 2>/dev/null | tail -n +"$(( KEEP + 1 ))" | xargs -r rm -f
# Legacy .sql.gz files from the old script follow the same rule.
find "$DIR" -maxdepth 1 -name "*.sql.gz" -type f -size -${MIN_BYTES}c -delete
echo "    kept: $(ls -1 "$DIR"/${PREFIX}-*.dump 2>/dev/null | wc -l) × $PREFIX  |  free: $(df -h / | awk 'NR==2{print $4}')"
