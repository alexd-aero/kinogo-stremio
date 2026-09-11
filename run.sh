#!/usr/bin/env bash
# Resurrect the addon and its Cloudflare tunnel. Both are systemd units, so
# this also re-arms them for the next reboot.
set -u
URL="https://kinogo-strmio.alexaero.dev/manifest.json"

sudo systemctl enable --now kinogo-vpn.service tinyproxy.service \
  kinogo-addon.service cloudflared-kinogo.service

echo "waiting for the tunnel to come up..."
for i in $(seq 1 20); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$URL" || true)
  if [ "$code" = "200" ]; then
    echo "up: $URL"
    exit 0
  fi
  sleep 3
done

echo "did not answer 200 in ~60s; current state:" >&2
systemctl --no-pager --lines=5 status kinogo-addon cloudflared-kinogo 2>&1 | grep -E 'Active:|●' >&2
exit 1
