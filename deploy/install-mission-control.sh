#!/usr/bin/env bash
set -euo pipefail

readonly TALIFLY_REPO=/home/talifly/projects/Talifly
readonly MONITOR_REPO=/home/talifly/projects/Talifly-AgentMonitor
readonly ADAPTER_REVIEWED_SHA=ec485d48cf8383ed46c055d0397c3ca06d43ff90
readonly MONITOR_REVIEWED_SHA=a36f7f9d0e95f96add964707dfd59dec2c6ca589
readonly ENV_FILE=/etc/talifly/mission-control.env
readonly PASSWORD_FILE=/home/talifly/.local/ai-team/mission-control.dashboard-password
readonly TOKEN_FILE=/home/talifly/projects/Talifly/.local/ai-team/mission-control.token
readonly NGINX_SITE=/etc/nginx/sites-available/talifly-mission-control
readonly NGINX_ENABLED=/etc/nginx/sites-enabled/talifly-mission-control

domain=''
email=''
http_config=''
https_config=''
password_temp=''
success=false

cleanup() {
  status=$?
  [[ -n $http_config ]] && rm -f "$http_config"
  [[ -n $https_config ]] && rm -f "$https_config"
  [[ -n $password_temp ]] && rm -f "$password_temp"
  if [[ $success != true ]]; then
    systemctl disable --now ai-team-mission-control.service talifly-mission-control.service >/dev/null 2>&1 || true
    rm -f "$NGINX_ENABLED" "$NGINX_SITE" \
      /etc/systemd/system/ai-team-mission-control.service \
      /etc/systemd/system/talifly-mission-control.service \
      "$ENV_FILE" "$PASSWORD_FILE"
    systemctl daemon-reload >/dev/null 2>&1 || true
    nginx -t >/dev/null 2>&1 && systemctl reload nginx >/dev/null 2>&1 || true
  fi
  trap - EXIT
  exit "$status"
}

usage() {
  echo "Usage: sudo $0 --domain mission-control.example.com --email operator@example.com" >&2
  exit 2
}

while (($#)); do
  case "$1" in
    --domain) domain="${2:-}"; shift 2 ;;
    --email) email="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done

[[ $EUID -eq 0 ]] || { echo 'Run this installer with sudo.' >&2; exit 1; }
[[ $domain =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || usage
[[ $email == *@*.* ]] || usage

for command in awk certbot curl getent git grep install ip ln nginx npm openssl runuser sed sort stat systemctl tr; do
  command -v "$command" >/dev/null || { echo "Missing required command: $command" >&2; exit 1; }
done

for target in \
  "$ENV_FILE" "$PASSWORD_FILE" "$NGINX_SITE" "$NGINX_ENABLED" \
  /etc/systemd/system/ai-team-mission-control.service \
  /etc/systemd/system/talifly-mission-control.service; do
  [[ ! -e $target ]] || {
    echo "Installation target already exists; refusing to overwrite: $target" >&2
    exit 1
  }
done
[[ -f $TOKEN_FILE ]] || { echo "Missing adapter token: $TOKEN_FILE" >&2; exit 1; }
[[ $(stat -c '%a' "$TOKEN_FILE") == 600 ]] || { echo 'Adapter token must have mode 0600.' >&2; exit 1; }
[[ -z $(git -C "$TALIFLY_REPO" status --porcelain) ]] || { echo 'Talifly checkout is dirty.' >&2; exit 1; }
[[ -z $(git -C "$MONITOR_REPO" status --porcelain) ]] || { echo 'AgentMonitor checkout is dirty.' >&2; exit 1; }
git -C "$TALIFLY_REPO" merge-base --is-ancestor "$ADAPTER_REVIEWED_SHA" HEAD || {
  echo 'Reviewed adapter commit is not present.' >&2; exit 1;
}
git -C "$MONITOR_REPO" merge-base --is-ancestor "$MONITOR_REVIEWED_SHA" HEAD || {
  echo 'Reviewed Mission Control commit is not present.' >&2; exit 1;
}

resolved=$(getent ahostsv4 "$domain" | awk '{print $1}' | sort -u)
local_addresses=$(ip -4 -o addr show scope global | awk '{split($4,a,"/"); print a[1]}' | sort -u)
grep -Fqx -f <(printf '%s\n' "$local_addresses") <(printf '%s\n' "$resolved") || {
  echo "$domain does not resolve to a public IPv4 address on this host." >&2
  exit 1
}

trap cleanup EXIT
runuser -u talifly -- npm --prefix "$MONITOR_REPO" run build:mission-control

install -d -m 0755 /etc/talifly /var/www/talifly-mission-control-acme
install -d -m 0700 -o talifly -g talifly /home/talifly/.local/ai-team
password_temp=$(mktemp)
openssl rand -base64 36 | tr -d '\n' > "$password_temp"
install -m 0600 -o talifly -g talifly "$password_temp" "$PASSWORD_FILE"
rm -f "$password_temp"
dashboard_password=$(cat "$PASSWORD_FILE")
umask 077
{
  echo 'PORT=3456'
  echo "DASHBOARD_PASSWORD=$dashboard_password"
  echo 'COOKIE_SECURE=true'
  echo 'TALIFLY_ADAPTER_URL=http://127.0.0.1:3460'
  echo "TALIFLY_ADAPTER_TOKEN_FILE=$TOKEN_FILE"
} > "$ENV_FILE"

install -m 0644 "$TALIFLY_REPO/ai-team/systemd/ai-team-mission-control.service" /etc/systemd/system/ai-team-mission-control.service
install -m 0644 "$MONITOR_REPO/deploy/systemd/talifly-mission-control.service" /etc/systemd/system/talifly-mission-control.service
systemctl daemon-reload
systemctl enable --now ai-team-mission-control.service talifly-mission-control.service
curl --fail --silent --show-error --retry 10 --retry-connrefused --retry-delay 1 \
  http://127.0.0.1:3460/health >/dev/null
local_auth_status=$(curl --silent --show-error --retry 10 --retry-connrefused --retry-delay 1 \
  --output /dev/null --write-out '%{http_code}' http://127.0.0.1:3456/api/auth/check)
[[ $local_auth_status == 401 ]] || { echo "Unexpected local auth status: $local_auth_status" >&2; exit 1; }

http_config=$(mktemp)
https_config=$(mktemp)
sed "s/__MISSION_CONTROL_DOMAIN__/$domain/g" "$MONITOR_REPO/deploy/nginx/mission-control-http.conf.template" > "$http_config"
install -m 0644 "$http_config" "$NGINX_SITE"
ln -s "$NGINX_SITE" "$NGINX_ENABLED"
nginx -t
systemctl reload nginx

certbot certonly --webroot -w /var/www/talifly-mission-control-acme \
  --non-interactive --agree-tos --email "$email" -d "$domain"

sed "s/__MISSION_CONTROL_DOMAIN__/$domain/g" "$MONITOR_REPO/deploy/nginx/mission-control-https.conf.template" > "$https_config"
install -m 0644 "$https_config" "$NGINX_SITE"
nginx -t
systemctl reload nginx

auth_status=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
  "https://$domain/api/auth/check")
[[ $auth_status == 401 ]] || { echo "Unexpected HTTPS auth status: $auth_status" >&2; exit 1; }
success=true
echo "Mission Control is installed at https://$domain"
echo "Dashboard password: $PASSWORD_FILE (mode 0600, owner talifly)"
