#!/bin/bash
# Drop the route so marked traffic fails closed rather than leaking out the
# normal US default route while the tunnel is down.
ip route del default table 100 2>/dev/null
exit 0
