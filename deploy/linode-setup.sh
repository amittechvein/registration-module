#!/bin/bash
# ============================================================================
# One-shot setup for the Registration Portal on a fresh Ubuntu 22.04/24.04
# Linode (or any VPS). Installs Node.js, PostgreSQL, Nginx; builds the app;
# runs it as a systemd service behind Nginx on port 80.
#
# Usage (as root on the new server):
#   wget https://raw.githubusercontent.com/amittechvein/registration-module/main/deploy/linode-setup.sh
#   bash linode-setup.sh
# Re-running is safe — it updates the code and restarts the service.
# ============================================================================
set -e

REPO="https://github.com/amittechvein/registration-module.git"
APP_DIR="/opt/registration"
ENV_FILE="$APP_DIR/server/.env"
DOMAIN="form.techvein.org"            # your domain (A record must point to this server)
CERT_EMAIL="tech_ai@techvein.com"     # for the free HTTPS certificate

echo "==> Installing system packages…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git nginx postgresql build-essential python3 openssl

if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 20 ]; then
  echo "==> Installing Node.js 20…"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "==> Setting up PostgreSQL…"
DB_PASS_FILE="/root/.registration_db_pass"
if [ ! -f "$DB_PASS_FILE" ]; then openssl rand -hex 12 > "$DB_PASS_FILE"; fi
DB_PASS=$(cat "$DB_PASS_FILE")
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='registration'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE USER registration WITH PASSWORD '$DB_PASS';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='registration'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE registration OWNER registration;"
sudo -u postgres psql -c "ALTER USER registration WITH PASSWORD '$DB_PASS';" >/dev/null

echo "==> Keeping PostgreSQL alive (auto-restart on crash, protected from the OOM killer)…"
# Sep 2026: the cluster crashed and stayed down for 5 days — Ubuntu's unit has
# no Restart= and the kernel OOM killer prefers big processes. Node (the app)
# must be the one that dies first; Postgres restarts itself if it ever does.
mkdir -p /etc/systemd/system/postgresql@.service.d
cat > /etc/systemd/system/postgresql@.service.d/override.conf <<'EOF'
[Service]
Restart=on-failure
RestartSec=10
OOMScoreAdjust=-900
EOF
systemctl daemon-reload
systemctl start postgresql
for c in $(pg_lsclusters -h 2>/dev/null | awk '{print $1"-"$2}'); do systemctl start "postgresql@$c"; done

echo "==> Installing backup + watchdog scripts…"
# The repo is already updated by Deploy.cmd (git pull runs before this script),
# so the scripts under deploy/ are current. Installed system-wide so systemd
# units and humans can call them by name.
if [ -f "$APP_DIR/deploy/backup.sh" ]; then
  install -m 755 "$APP_DIR/deploy/backup.sh"   /usr/local/bin/registration-backup
  install -m 755 "$APP_DIR/deploy/watchdog.sh" /usr/local/bin/registration-watchdog
fi

echo "==> Safety backup BEFORE updating (data protection for live forms/payments)…"
mkdir -p /opt/backups
if sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='registration'" | grep -q 1; then
  # A failed snapshot aborts the deploy (set -e) — never deploy without one.
  /usr/local/bin/registration-backup pre-deploy 3
  echo "    Restore: sudo -u postgres pg_restore -d registration --clean --if-exists --no-owner /opt/backups/FILE.dump"
fi

echo "==> Fetching application code…"
if [ -d "$APP_DIR/.git" ]; then git -C "$APP_DIR" pull; else git clone "$REPO" "$APP_DIR"; fi

echo "==> Installing dependencies & building client…"
cd "$APP_DIR/server" && npm install --no-audit --no-fund
cd "$APP_DIR/client" && npm install --no-audit --no-fund && npm run build

if [ ! -f "$ENV_FILE" ]; then
  echo "==> Creating $ENV_FILE (first run)…"
  cat > "$ENV_FILE" <<EOF
PORT=5000
JWT_SECRET=$(openssl rand -hex 24)
DATABASE_URL=postgres://registration:$DB_PASS@localhost:5432/registration

# --- fill these in, then: systemctl restart registration ---
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
INFOBIP_USERNAME=
INFOBIP_PASSWORD=
INFOBIP_SENDER=TCVEIN
DEV_SHOW_OTP=true
SCHOOL_NAME="Nirmala Convent School, Siliguri"
SCHOOL_ADDRESS="3rd Mile, Sevoke Road, Ward 42, Siliguri, West Bengal 734008"
EOF
else
  echo "==> Keeping existing $ENV_FILE"
fi

echo "==> Creating systemd service…"
cat > /etc/systemd/system/registration.service <<EOF
[Unit]
Description=School Registration Portal
After=network.target postgresql.service
Wants=postgresql.service

[Service]
WorkingDirectory=$APP_DIR/server
ExecStart=$(command -v node) src/index.js
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable registration
systemctl restart registration

echo "==> Installing health watchdog (restarts Postgres/app if down, warns on low disk)…"
cat > /etc/systemd/system/registration-watchdog.service <<'EOF'
[Unit]
Description=Registration portal health watchdog

[Service]
Type=oneshot
ExecStart=/usr/local/bin/registration-watchdog
EOF
cat > /etc/systemd/system/registration-watchdog.timer <<'EOF'
[Unit]
Description=Check registration portal health every 2 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=2min

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now registration-watchdog.timer

echo "==> Installing nightly database backup (2:30 AM IST, keeps 7 good dumps; emails Owners on failure)…"
cat > /etc/systemd/system/registration-backup.service <<'EOF'
[Unit]
Description=Nightly registration database backup

[Service]
Type=oneshot
ExecStart=/usr/local/bin/registration-backup nightly 7
EOF
cat > /etc/systemd/system/registration-backup.timer <<'EOF'
[Unit]
Description=Nightly registration DB backup at 21:00 UTC (2:30 AM IST)

[Timer]
OnCalendar=*-*-* 21:00:00
Persistent=true

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now registration-backup.timer

echo "==> Configuring Nginx for $DOMAIN…"
NGX="/etc/nginx/sites-available/registration"
# IMPORTANT: never overwrite a config that certbot has already upgraded to
# HTTPS — rewriting it would delete the 443 server block and break the domain
# (techvein.org sends HSTS, so browsers force https on all subdomains).
if grep -q "listen 443" "$NGX" 2>/dev/null; then
  echo "==> Nginx config already has HTTPS — leaving it untouched."
else
  cat > "$NGX" <<EOF
server {
    listen 80 default_server;
    server_name $DOMAIN _;
    client_max_body_size 10m;
    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
fi
ln -sf /etc/nginx/sites-available/registration /etc/nginx/sites-enabled/registration
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

IP=$(hostname -I | awk '{print $1}')
sleep 3

# Free HTTPS via Let's Encrypt — works once the domain's A record points here
echo "==> Ensuring HTTPS for $DOMAIN…"
if grep -q "listen 443" "$NGX" 2>/dev/null; then
  echo "==> HTTPS already configured."
  SITE_URL="https://$DOMAIN"
elif [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  # Certificate exists but nginx lost the 443 block — reinstall it.
  apt-get install -y certbot python3-certbot-nginx
  certbot --nginx -d "$DOMAIN" -m "$CERT_EMAIL" --agree-tos --redirect --non-interactive || \
    echo "!! certbot failed — run manually: certbot --nginx -d $DOMAIN"
  SITE_URL="https://$DOMAIN"
else
  DNS_IP=$(getent ahostsv4 "$DOMAIN" | awk '{print $1}' | head -1 || true)
  if [ "$DNS_IP" = "$IP" ]; then
    apt-get install -y certbot python3-certbot-nginx
    certbot --nginx -d "$DOMAIN" -m "$CERT_EMAIL" --agree-tos --redirect --non-interactive || \
      echo "!! certbot failed — run manually later: certbot --nginx -d $DOMAIN"
    SITE_URL="https://$DOMAIN"
  else
    echo "!! $DOMAIN does not point to $IP yet (currently: ${DNS_IP:-not set})."
    echo "   Add an A record for 'form' → $IP at your DNS provider, wait a few"
    echo "   minutes, then re-run this script to enable HTTPS automatically."
    SITE_URL="http://$IP"
  fi
fi

echo ""
echo "============================================================"
echo "  DONE! Portal is live."
echo "  Public site : $SITE_URL/"
echo "  Admin panel : $SITE_URL/admin  (admin@school.com / admin123)"
echo "  Nursery form: $SITE_URL/form/nursery-registration-2026-27"
echo ""
echo "  Next steps:"
echo "   1. nano $ENV_FILE   → add Razorpay + Infobip keys,"
echo "      set DEV_SHOW_OTP=false, then: systemctl restart registration"
echo "   2. Change the admin password."
echo "  Update later: just re-run this script (git pull + rebuild + restart)."
echo "============================================================"
