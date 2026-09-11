#!/bin/bash
# openvpn --up: point routing table 100 at the tunnel. Runs on every (re)connect
# because VPN Gate hands out a different address each time, so anything keyed to
# the address itself would rot. Traffic is selected by fwmark, set in iptables.
ip route replace default via "$ifconfig_remote" dev "$dev" table 100
ip route flush cache
exit 0
