#!/usr/bin/env bash
set -euo pipefail
: "${ORIGIN_TURN_PUBLIC_IP:?Set the relay public IPv4 address}"
if [[ ! "$ORIGIN_TURN_PUBLIC_IP" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
  printf 'Expected an IPv4 address\n' >&2
  exit 1
fi
# Both peers can use this relay, but TURN cannot probe other services on the host.
iptables -w -N ORIGIN_TURN_EGRESS 2>/dev/null || iptables -w -L ORIGIN_TURN_EGRESS -n >/dev/null
iptables -w -C ORIGIN_TURN_EGRESS -d "$ORIGIN_TURN_PUBLIC_IP" -p udp --dport 49160:49260 -j RETURN 2>/dev/null || iptables -w -A ORIGIN_TURN_EGRESS -d "$ORIGIN_TURN_PUBLIC_IP" -p udp --dport 49160:49260 -j RETURN
iptables -w -C ORIGIN_TURN_EGRESS -d "$ORIGIN_TURN_PUBLIC_IP" -j REJECT 2>/dev/null || iptables -w -A ORIGIN_TURN_EGRESS -d "$ORIGIN_TURN_PUBLIC_IP" -j REJECT
iptables -w -C OUTPUT -m owner --uid-owner 3478 -j ORIGIN_TURN_EGRESS 2>/dev/null || iptables -w -I OUTPUT -m owner --uid-owner 3478 -j ORIGIN_TURN_EGRESS
