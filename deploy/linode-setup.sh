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

echo "==> Configuring Nginx for $DOMAIN…"
cat > /etc/nginx/sites-available/registration <<EOF
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
ln -sf /etc/nginx/sites-available/registration /etc/nginx/sites-enabled/registration
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

IP=$(hostname -I | awk '{print $1}')
sleep 3

# Free HTTPS via Let's Encrypt — works once the domain's A record points here
echo "==> Attempting HTTPS certificate for $DOMAIN…"
DNS_IP=$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1 || true)
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
