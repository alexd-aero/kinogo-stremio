#!/bin/bash
# Choose a working Russian VPN Gate relay.
#
# These are volunteer relays and they rot: the one this started on kept its
# OpenVPN control channel up ("Initialization Sequence Completed") while
# passing no data at all, so "is the service running" is not a usable health
# signal. Every candidate is therefore checked by actually moving traffic.
set -u
DIR=/home/rasp-alex2/.kinogo-vpn
LIST=/tmp/vpngate.csv

curl -s --max-time 60 "https://www.vpngate.net/api/iphone/" -o "$LIST" || exit 1

mapfile -t CANDIDATES < <(python3 - "$LIST" <<'PY'
import csv,sys
rows=[l for l in open(sys.argv[1],encoding='utf-8',errors='replace').read().splitlines()
      if l and not l.startswith('*')]
hdr=rows[0].lstrip('#').split(',')
ru=[x for x in csv.DictReader(rows[1:],fieldnames=hdr)
    if (x.get('CountryShort') or '').strip()=='RU' and x.get('OpenVPN_ConfigData_Base64')]
def score(x):
    try: return (int(x.get('Speed') or 0), -int(x.get('Ping') or 999))
    except Exception: return (0,-999)
for x in sorted(ru,key=score,reverse=True)[:6]:
    print(f"{x['IP']}\t{x['OpenVPN_ConfigData_Base64']}")
PY
)

[ ${#CANDIDATES[@]} -eq 0 ] && { echo "no RU relays listed"; exit 1; }

for entry in "${CANDIDATES[@]}"; do
  ip=${entry%%$'\t'*}
  b64=${entry#*$'\t'}
  echo "trying $ip"

  # route-nopull is passed on the command line; strip anything that would
  # still try to reshape this host's routing or DNS.
  printf '%s' "$b64" | base64 -d 2>/dev/null \
    | grep -viE '^(redirect-gateway|dhcp-option|block-outside-dns)' > "$DIR/ru.ovpn.new" || continue
  grep -q '^remote ' "$DIR/ru.ovpn.new" || continue

  mv "$DIR/ru.ovpn.new" "$DIR/ru.ovpn"
  chmod 600 "$DIR/ru.ovpn"
  systemctl restart kinogo-vpn

  for _ in $(seq 1 10); do
    sleep 3
    gw=$(ip -4 -o addr show tun10 2>/dev/null | awk '{print $6}' | cut -d/ -f1)
    [ -z "$gw" ] && continue
    # Real traffic, not just interface state.
    if curl -s --max-time 12 -x http://127.0.0.1:8888 https://ipinfo.io/country 2>/dev/null | grep -q RU; then
      echo "OK: $ip is passing traffic"
      exit 0
    fi
  done
  echo "  $ip did not pass traffic"
done

echo "no working RU relay found"
exit 1
