#!/usr/bin/env bash
set -euo pipefail

# Establish SSH tunnel to remote app-server and wait for it to be ready.
#
# Required env vars:
#   SSH_DEST     - SSH destination (user@host)
#   SSH_KEY      - Path to SSH key
#   KNOWN_HOSTS  - Path to known_hosts file

ssh -i "$SSH_KEY" \
	-o BatchMode=yes \
	-o StrictHostKeyChecking=yes \
	-o UserKnownHostsFile="$KNOWN_HOSTS" \
	-o ServerAliveInterval=15 \
	-N -L 18790:127.0.0.1:18790 \
	"$SSH_DEST" \
	>/tmp/nixmac-e2e-tunnel.log 2>&1 &
echo $! >/tmp/nixmac-e2e-tunnel.pid

for _ in {1..20}; do
	if command -v nc >/dev/null 2>&1 && nc -z 127.0.0.1 18790; then
		exit 0
	fi
	if bash -c '</dev/tcp/127.0.0.1/18790' >/dev/null 2>&1; then
		exit 0
	fi
	sleep 1
done
cat /tmp/nixmac-e2e-tunnel.log
exit 1
