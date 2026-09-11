#!/usr/bin/env bash
# Stop the addon and its tunnel, and keep them down across reboots.
# Only touches this project's units — the mailhook and pi-vpn tunnels are
# separate services and are deliberately left running.
set -u
sudo systemctl disable --now cloudflared-kinogo.service kinogo-addon.service \
  tinyproxy.service kinogo-vpn.service

for u in kinogo-addon cloudflared-kinogo tinyproxy kinogo-vpn; do
  printf '%-22s %s\n' "$u" "$(systemctl is-active "$u" 2>/dev/null)"
done
