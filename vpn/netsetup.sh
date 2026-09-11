#!/bin/bash
# Idempotent packet-routing rules for the split tunnel. Run before OpenVPN
# starts; none of this survives a reboot on its own.
#
# Selection is by fwmark rather than source address because VPN Gate issues a
# different tunnel address on every reconnect.
set -u
MARK=0x64
TABLE=100
TP_UID=$(id -u tinyproxy 2>/dev/null || echo 116)

# tinyproxy's egress -> table 100 (the tunnel).
ip rule del fwmark $MARK lookup $TABLE 2>/dev/null
ip rule add fwmark $MARK lookup $TABLE
iptables -t mangle -C OUTPUT -m owner --uid-owner "$TP_UID" -j MARK --set-mark $MARK 2>/dev/null \
  || iptables -t mangle -A OUTPUT -m owner --uid-owner "$TP_UID" -j MARK --set-mark $MARK

# The socket picks its source address before the mark reroutes it, so without
# this the packets leave tun10 wearing the LAN address and the server drops them.
iptables -t nat -C POSTROUTING -o tun10 -j MASQUERADE 2>/dev/null \
  || iptables -t nat -A POSTROUTING -o tun10 -j MASQUERADE

# Path MTU discovery does not survive this path; clamp so large pages complete.
iptables -t mangle -C POSTROUTING -o tun10 -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1200 2>/dev/null \
  || iptables -t mangle -A POSTROUTING -o tun10 -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1200
exit 0
