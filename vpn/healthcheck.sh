#!/bin/bash
# Rotate to another relay when the current one stops passing traffic.
# Checked by fetching through the proxy, because the tunnel can report itself
# up and still be dead: the first relay held its OpenVPN control channel open
# while dropping 100% of data.
set -u
for _ in 1 2 3; do
  if curl -s --max-time 12 -x http://127.0.0.1:8888 https://ipinfo.io/country 2>/dev/null | grep -q RU; then
    exit 0
  fi
  sleep 5
done
echo "relay is not passing traffic — rotating"
exec /home/rasp-alex2/.kinogo-vpn/pick-server.sh
