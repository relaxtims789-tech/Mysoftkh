#!/usr/bin/env bash
# QR Attendance - server set-up and update (Ubuntu / Debian).
#
#   First time:  bash setup.sh      (asks for the web address and your email, then starts everything)
#   Updating:    unzip -o qr-attendance-deploy.zip && bash setup.sh      (keeps .env, data and backups)
#
# Run it as root inside the folder where you unzipped qr-attendance-deploy.zip (e.g. /opt/qr-attendance).
set -euo pipefail
cd "$(dirname "$0")"

say()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m    %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!!  %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31mXX  %s\033[0m\n' "$*"; exit 1; }
rand() { head -c 64 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c "$1"; }

[ "$(id -u)" -eq 0 ] || die "Please run as root:  sudo bash setup.sh"
[ -f docker-compose.yml ] && [ -f Dockerfile ] || die "Run this inside the unzipped qr-attendance folder."

# ---------------------------------------------------------------------------------------------------------------
say "Checking the server"
if ! command -v docker >/dev/null 2>&1; then
  say "Installing Docker (about 1 minute)"
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || die "Docker Compose is missing. Install the docker-compose-plugin package and run again."
ok "Docker $(docker --version | awk '{print $3}' | tr -d ,)"

# Building needs about 1.5 GB of memory; small VPSs get a swap file so the build does not run out.
mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
swap_mb=$(awk '/SwapTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$mem_mb" -lt 1900 ] && [ "$swap_mb" -lt 1000 ] && [ ! -f /swapfile ]; then
  say "Only ${mem_mb} MB of memory: adding a 2 GB swap file so the build does not fail"
  fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
  chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  ok "Swap file added"
fi

# Open the web ports only if the firewall is already on (never switch it on here: that could lock out SSH).
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q '^Status: active'; then
  ufw allow 80/tcp >/dev/null && ufw allow 443 >/dev/null && ok "Firewall: ports 80 and 443 open"
fi

# ---------------------------------------------------------------------------------------------------------------
new_admin_password=""
if [ -f .env ]; then
  say "Using the existing settings in .env"
else
  say "Settings"
  while true; do
    read -rp "    Web address for the system (e.g. attendance.yourcompany.com): " DOMAIN
    DOMAIN=$(printf '%s' "$DOMAIN" | tr 'A-Z' 'a-z' | sed -E 's#^https?://##; s#/.*$##; s/[[:space:]]//g')
    [[ "$DOMAIN" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] && break
    warn "That does not look like a web address. Type only the address, e.g. attendance.camprotec.com"
  done
  while true; do
    read -rp "    Your email (you sign in to the admin dashboard with it): " ADMIN_EMAIL
    ADMIN_EMAIL=$(printf '%s' "$ADMIN_EMAIL" | tr 'A-Z' 'a-z' | tr -d '[:space:]')
    [[ "$ADMIN_EMAIL" =~ ^[^@]+@[^@]+\.[^@]+$ ]] && break
    warn "Please type a valid email address."
  done
  new_admin_password="Qa$(rand 8)7"
  umask 077
  cat > .env <<EOF
# Created by setup.sh on $(date -u +%Y-%m-%d). Keep a copy somewhere safe (not on this server only).
DOMAIN=${DOMAIN}
DB_PASSWORD=$(rand 40)
JWT_SECRET=$(rand 64)
SUPERADMIN_EMAIL=${ADMIN_EMAIL}
SUPERADMIN_PASSWORD=${new_admin_password}
BACKUP_DAYS=14
BACKUP_HOUR_UTC=18
EOF
  umask 022
  ok "Settings saved in .env"
fi
sed -i 's/\r$//' .env   # a .env edited on Windows has CRLF line ends

# A required value missing from .env (e.g. a line deleted while editing): take it back from the running system, so
# nobody is signed out and the database password still matches.
envof() { docker inspect "$1" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | sed -n "s/^$2=//p" | head -1; }
restore() {
  local key=$1 value=$2
  if [ -z "$(grep -E "^${key}=" .env | head -1 | cut -d= -f2-)" ]; then
    [ -n "$value" ] || die "${key} is empty in .env and the running system does not have it either. Send a screenshot of: grep -c ${key} .env"
    cp .env ".env.backup-$(date +%Y%m%d-%H%M%S)"
    grep -vE "^${key}=" .env > .env.tmp; printf '%s=%s\n' "$key" "$value" >> .env.tmp; mv .env.tmp .env; chmod 600 .env
    ok "${key} was missing in .env; restored it from the running system"
  fi
}
app_id=$(docker ps --format '{{.ID}} {{.Names}}' 2>/dev/null | awk '/qr-attendance.app/{print $1; exit}' || true)
db_id=$(docker ps --format '{{.ID}} {{.Names}}' 2>/dev/null | awk '/qr-attendance.db/{print $1; exit}' || true)
restore JWT_SECRET "$([ -n "$app_id" ] && envof "$app_id" JWT_SECRET)"
restore DB_PASSWORD "$([ -n "$db_id" ] && envof "$db_id" POSTGRES_PASSWORD)"
restore DOMAIN "$([ -n "$app_id" ] && envof "$app_id" PUBLIC_URL | sed 's#^https://##')"

DOMAIN=$(grep -E '^DOMAIN=' .env | head -1 | cut -d= -f2- | tr -d '[:space:]')
[ -n "$DOMAIN" ] || die "DOMAIN is empty in .env"

# Public website addresses (asked once; stored in .env, empty = none).
if ! grep -qE '^WEBSITE_DOMAINS=' .env; then
  echo
  echo "    The public website (prices and free-trial sign-up) is always at https://${DOMAIN}/"
  echo "    It can also answer on your main address, e.g.  mysoftkh.com www.mysoftkh.com"
  read -rp "    Website addresses (separate with spaces, or press Enter to skip): " WEBSITE_DOMAINS
  WEBSITE_DOMAINS=$(printf '%s' "$WEBSITE_DOMAINS" | tr 'A-Z,' 'a-z ' | sed -E 's#https?://##g; s#/[^ ]*##g; s/[[:space:]]+/ /g; s/^ //; s/ $//')
  echo "WEBSITE_DOMAINS=${WEBSITE_DOMAINS}" >> .env
fi
WEBSITE_DOMAINS=$(grep -E '^WEBSITE_DOMAINS=' .env | head -1 | cut -d= -f2-)

# Public demo (asked once; stored in .env, empty = no demo): "DemoCompany" with 6 months of sample data, rebuilt nightly.
setenv() { grep -vE "^$1=" .env > .env.tmp || true; printf '%s=%s\n' "$1" "$2" >> .env.tmp; mv .env.tmp .env; chmod 600 .env; }
clean_hosts() { printf '%s' "$1" | tr 'A-Z,' 'a-z ' | sed -E 's#https?://##g; s#/[^ ]*##g; s/[[:space:]]+/ /g; s/^ //; s/ $//'; }
if ! grep -qE '^DEMO_DOMAIN=' .env; then
  echo
  echo "    Optional public demo for customers: company 'DemoCompany' with 6 months of sample data, put back every night."
  echo "    The address must start with 'demo.', e.g.  demo.attendance.mysoftkh.com"
  read -rp "    Demo address (or press Enter to skip): " DEMO_DOMAIN || true
  setenv DEMO_DOMAIN "$(clean_hosts "$DEMO_DOMAIN")"
fi
DEMO_DOMAIN=$(grep -E '^DEMO_DOMAIN=' .env | head -1 | cut -d= -f2- | tr -d '[:space:]' || true)
if [ -n "$DEMO_DOMAIN" ]; then
  if ! grep -qE '^DEMO_WEBSITE_DOMAINS=' .env; then
    echo "    The website can also show the demo, e.g.  demo.mysoftkh.com www.demo.mysoftkh.com"
    read -rp "    Demo website addresses (separate with spaces, or press Enter to skip): " DEMO_WEBSITE_DOMAINS || true
    setenv DEMO_WEBSITE_DOMAINS "$(clean_hosts "$DEMO_WEBSITE_DOMAINS")"
  fi
  for d in $DEMO_DOMAIN $(grep -E '^DEMO_WEBSITE_DOMAINS=' .env | head -1 | cut -d= -f2-); do
    [[ "$d" == demo.* || "$d" == www.demo.* ]] || die "Demo address '$d' must start with 'demo.' or 'www.demo.'. Fix it in .env (nano .env) and run again."
  done
  demo_id=$(docker ps --format '{{.ID}} {{.Names}}' 2>/dev/null | awk '/qr-attendance.demo/{print $1; exit}' || true)
  if [ -z "$(grep -E '^DEMO_JWT_SECRET=' .env | head -1 | cut -d= -f2-)" ]; then
    old=$([ -n "$demo_id" ] && envof "$demo_id" JWT_SECRET || true)
    setenv DEMO_JWT_SECRET "${old:-$(rand 64)}"
  fi
  grep -qE '^COMPOSE_PROFILES=.*demo' .env || setenv COMPOSE_PROFILES demo
else
  if grep -qE "^COMPOSE_PROFILES=" .env; then setenv COMPOSE_PROFILES ""; fi
fi
DEMO_WEBSITE_DOMAINS=$(grep -E '^DEMO_WEBSITE_DOMAINS=' .env | head -1 | cut -d= -f2- || true)

mkdir -p data data-demo backups
chown -R 1000:1000 data data-demo

# ---------------------------------------------------------------------------------------------------------------
say "Checking that ${DOMAIN} points to this server"
server_ip=$(curl -fsS4 --max-time 8 https://api.ipify.org 2>/dev/null || true)
dns_ip=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1 {print $1}' || true)
if [ -z "$dns_ip" ]; then
  warn "${DOMAIN} has no DNS record yet. Add an A record pointing to ${server_ip:-the IP address of this server}."
  warn "The system starts anyway; HTTPS starts working a few minutes after DNS is in place."
elif [ -n "$server_ip" ] && [ "$dns_ip" != "$server_ip" ]; then
  warn "${DOMAIN} points to ${dns_ip}, but this server is ${server_ip}."
  warn "Fix the A record (if you use Cloudflare, set it to 'DNS only' / grey cloud). HTTPS works once it matches."
else
  ok "${DOMAIN} -> ${dns_ip}"
fi
for w in $WEBSITE_DOMAINS $DEMO_DOMAIN $DEMO_WEBSITE_DOMAINS; do
  wip=$(getent ahostsv4 "$w" 2>/dev/null | awk 'NR==1 {print $1}' || true)
  if [ -n "$server_ip" ] && [ "$wip" = "$server_ip" ]; then ok "${w} -> ${wip}"
  else warn "${w} points to ${wip:-nothing}, not to ${server_ip:-this server}. Set its A record to ${server_ip:-this server} (at GoDaddy: turn off forwarding / parking)."; fi
done

# ---------------------------------------------------------------------------------------------------------------
# If something else (e.g. SMW's Caddy) already serves ports 80/443, run without our own Caddy.
our_caddy=$(docker ps -a --format '{{.Names}}' 2>/dev/null | grep -E 'qr-attendance.caddy' || true)
shared=0
if [ -z "$our_caddy" ] && ss -ltnH 2>/dev/null | awk '{print $4}' | grep -Eq '[:.](80|443)$'; then
  shared=1
fi

if [ "$shared" -eq 1 ]; then
  say "Ports 80/443 are used by another web server (SMW?). Starting without our own HTTPS proxy"
  docker compose up -d --build db app backup
else
  # Check the HTTPS proxy settings first, so a mistake never takes the running site down.
  if ! docker run --rm -e DOMAIN="$DOMAIN" -e WEBSITE_DOMAINS="$WEBSITE_DOMAINS" -e DEMO_DOMAIN="$DEMO_DOMAIN" -e DEMO_WEBSITE_DOMAINS="$DEMO_WEBSITE_DOMAINS" \
       -v "$(pwd)/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/tmp/caddy-validate.log 2>&1; then
    tail -20 /tmp/caddy-validate.log
    die "The Caddyfile is not valid (see above). Nothing was changed on the running site."
  fi
  say "Building and starting (first time: 3-6 minutes)"
  docker compose up -d --build
  # The Caddyfile is mounted read-only: reload it so new addresses are served without a restart.
  docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || true
fi

say "Waiting for the app to start"
for i in $(seq 1 60); do
  if docker compose exec -T app wget -qO- http://127.0.0.1:3200/api/health >/dev/null 2>&1; then ok "App is running"; break; fi
  [ "$i" -eq 60 ] && { docker compose logs --tail 40 app; die "The app did not start. See the log above."; }
  sleep 3
done

if [ -n "$DEMO_DOMAIN" ]; then
  say "Waiting for the demo (the first time it builds 6 months of sample data)"
  for i in $(seq 1 60); do
    if docker compose exec -T demo wget -qO- http://127.0.0.1:3200/api/health >/dev/null 2>&1; then ok "Demo is running"; break; fi
    [ "$i" -eq 60 ] && { docker compose logs --tail 40 demo; warn "The demo did not start. See the log above (the main system is not affected)."; }
    sleep 3
  done
fi

if [ "$shared" -eq 0 ]; then
  say "Checking https://${DOMAIN} (the certificate can take a minute)"
  for i in $(seq 1 20); do
    if curl -fsS --max-time 8 "https://${DOMAIN}/api/health" >/dev/null 2>&1; then ok "HTTPS works"; break; fi
    [ "$i" -eq 20 ] && warn "HTTPS is not answering yet. Usually DNS is not ready; it starts by itself once it is (see: docker compose logs caddy)."
    sleep 6
  done
fi

# ---------------------------------------------------------------------------------------------------------------
printf '\n\033[1;32m%s\033[0m\n' "QR Attendance is installed."
echo
echo "  Admin dashboard:  https://${DOMAIN}/admin"
echo "  Employee app:     https://${DOMAIN}/app     (employees open it on their phone and choose 'Add to Home Screen')"
if [ -n "$new_admin_password" ]; then
  echo
  echo "  First sign-in:    $(grep -E '^SUPERADMIN_EMAIL=' .env | cut -d= -f2-)"
  echo "  Temporary password: ${new_admin_password}     (you must change it at first sign-in)"
fi
echo
if [ -n "$DEMO_DOMAIN" ]; then
  echo
  echo "  Public demo:      https://${DEMO_DOMAIN}/admin   sign in: DemoCompany / password $(grep -E '^DEMO_PASSWORD=' .env | cut -d= -f2- | grep . || echo democompany123456)"
  echo "                    https://${DEMO_DOMAIN}/app     company code DemoCompany, employee E0001, same password"
  for w in $DEMO_WEBSITE_DOMAINS; do echo "                    https://${w}/   (website with the demo sign-in)"; done
  echo "                    Sample data is rebuilt every night at 03:00 (Phnom Penh)."
fi
echo
echo "  Backups:          $(pwd)/backups  (every night, kept 14 days - copy them off the server regularly)"
echo "  Settings:         $(pwd)/.env     (keep a copy somewhere safe)"
echo "  Logs:             docker compose logs -f app"

if [ "$shared" -eq 1 ]; then
  cat <<EOF

  ONE MORE STEP - let the existing web server (SMW's Caddy) serve ${DOMAIN}:

  1. In /opt/smw/docker-compose.yml, under the 'caddy:' service add:
         networks: [default, qr-attendance]
     and at the very end of the file add:
         networks:
           qr-attendance:
             external: true

  2. At the end of /opt/smw/Caddyfile add:
         ${DOMAIN} ${WEBSITE_DOMAINS} {
         	encode gzip
         	header -Server
         	reverse_proxy qr-attendance-app:3200
         }

  3. Run:  cd /opt/smw && docker compose up -d caddy

  Then open https://${DOMAIN}/admin
EOF
fi
echo
