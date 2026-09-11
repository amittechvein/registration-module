#!/bin/bash
# ============================================================================
# Health watchdog — installed to /usr/local/bin/registration-watchdog and run
# every 2 minutes by registration-watchdog.timer.
#
# Checks, in dependency order:
#   1. PostgreSQL accepting connections   → start the cluster(s) if not
#   2. App answering /api/health          → restart the app if not
#   3. Disk space                         → warn Owners once a day under 2 GB
#
# Sep 2026 incident: Postgres crashed and stayed down for 5 days. The old
# watchdog only knew about the app, so it restarted the app every 2 minutes
# (which immediately died again because the DB was gone) and nobody was told.
# ============================================================================
APP=/opt/registration/server
alert() {  # alert <subject> <body>  — best effort, via the app's mailer
  [ -f "$APP/alert.js" ] || return 0
  (cd "$APP" && timeout 60 node alert.js "$1" "$2" >/dev/null 2>&1) || true
}
once_per_day() {  # once_per_day <key> — true the first time today
  local f="/run/registration-watchdog.$1.$(date +%Y%m%d)"
  [ -e "$f" ] && return 1
  touch "$f"; return 0
}

# 1. PostgreSQL
if ! pg_isready -h 127.0.0.1 -p 5432 -q; then
  echo "postgres DOWN - starting cluster(s)"
  for c in $(pg_lsclusters -h 2>/dev/null | awk '{print $1"-"$2}'); do
    systemctl start "postgresql@$c" || true
  done
  systemctl start postgresql || true
  sleep 8
  if pg_isready -h 127.0.0.1 -p 5432 -q; then
    echo "postgres recovered"
    alert "form.techvein.org: PostgreSQL was down and has been restarted" \
      "The watchdog found PostgreSQL not responding at $(date -Is) and started it successfully.
Check why: ssh root@172.105.49.152 'tail -50 /var/log/postgresql/postgresql-16-main.log; free -m; df -h /'"
    systemctl restart registration
  else
    echo "postgres STILL DOWN"
    once_per_day pgdown && alert "URGENT: PostgreSQL is DOWN on form.techvein.org and could not be restarted" \
      "The watchdog could not start PostgreSQL at $(date -Is). The portal is offline for parents.
ssh root@172.105.49.152 'systemctl status postgresql@16-main; tail -50 /var/log/postgresql/postgresql-16-main.log; df -h /; free -m'"
    exit 0   # no point restarting the app until the DB is back
  fi
fi

# 2. App
if ! curl -sf --max-time 10 http://127.0.0.1:5000/api/health >/dev/null; then
  echo "health check FAILED - restarting registration"
  systemctl restart registration
fi

# 3. Disk
FREE_MB=$(df -m / | awk 'NR==2{print $4}')
if [ "$FREE_MB" -lt 2048 ]; then
  echo "disk low: ${FREE_MB} MB free"
  once_per_day disk && alert "form.techvein.org: disk space low (${FREE_MB} MB free)" \
    "Only ${FREE_MB} MB free on the server. Backups need ~2.5 GB each.
Biggest users: $(du -sh /opt/backups /var/lib/postgresql /var/log 2>/dev/null | tr '\n' ' ')
Prune: ssh root@172.105.49.152 'ls -lh /opt/backups'  — or resize the Linode disk."
fi
