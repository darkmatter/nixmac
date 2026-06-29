#!/usr/bin/env bash
# =============================================================================
# ci-entrypoint.sh — nixmac CI container entrypoint
#
# Starts nix-daemon in the background (Determinate Nix installed with
# --init none has no systemd service), then execs the container command.
#
# GitHub Actions starts the container with a keepalive command (tail -f /dev/null)
# and execs each step via `docker exec`. This entrypoint ensures nix-daemon is
# running before the first exec'd step.
# =============================================================================

set -euo pipefail

# Start nix-daemon if not already running. The PID file prevents duplicates
# if the entrypoint is somehow re-invoked.
NIX_DAEMON_SOCKET="/nix/var/nix/daemon-socket/socket"
NIX_DAEMON_LOG="/var/log/nix-daemon.log"

if [ ! -S "$NIX_DAEMON_SOCKET" ]; then
  mkdir -p "$(dirname "$NIX_DAEMON_LOG")"
  nohup nix-daemon &>"$NIX_DAEMON_LOG" &
  disown
  for _ in $(seq 1 50); do
    if [ -S "$NIX_DAEMON_SOCKET" ]; then
      break
    fi
    sleep 0.2
  done
fi

exec "$@"
