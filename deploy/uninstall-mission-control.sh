#!/usr/bin/env bash
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo 'Run this rollback with sudo.' >&2; exit 1; }
[[ ${1:-} == --confirm ]] || {
  echo "Usage: sudo $0 --confirm" >&2
  exit 2
}

systemctl disable --now talifly-mission-control.service ai-team-mission-control.service || true
rm -f \
  /etc/nginx/sites-enabled/talifly-mission-control \
  /etc/nginx/sites-available/talifly-mission-control \
  /etc/systemd/system/talifly-mission-control.service \
  /etc/systemd/system/ai-team-mission-control.service \
  /etc/talifly/mission-control.env \
  /home/talifly/.local/ai-team/mission-control.dashboard-password
systemctl daemon-reload
nginx -t
systemctl reload nginx

echo 'Mission Control services and proxy were removed.'
echo 'Repositories, Orchestrator state, adapter token and any certificate were preserved.'
