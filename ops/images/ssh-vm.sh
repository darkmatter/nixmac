#!/bin/bash
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: ssh-vm.sh user@host [command ...]" >&2
  exit 64
fi
: "${SSH_PASSWORD:?SSH_PASSWORD is required}"

host="$1"
shift
askpass="$(mktemp)"
# Invoked indirectly by the EXIT trap.
# shellcheck disable=SC2329
cleanup() {
  rm -f "$askpass"
}
trap cleanup EXIT

/bin/cat > "$askpass" <<'ASKPASS'
#!/bin/sh
printf '%s\n' "$SSH_PASSWORD"
ASKPASS
chmod 700 "$askpass"

status=0
env DISPLAY=:0 SSH_ASKPASS="$askpass" SSH_ASKPASS_REQUIRE=force \
  ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
  -o ConnectTimeout=5 -o PreferredAuthentications=password \
  -o PubkeyAuthentication=no "$host" "$@" || status=$?
exit "$status"
