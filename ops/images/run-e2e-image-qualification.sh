#!/bin/bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: run-e2e-image-qualification.sh <vm-name> <first boot|aged boot>" >&2
  exit 64
fi

VM_NAME="$1"
QUALIFICATION_STAGE="$2"
SSH_PASSWORD="${NIXMAC_E2E_SSH_PASSWORD:-nixmac-e2e-local-only}"
VM_PID=""

case "$QUALIFICATION_STAGE" in
  "first boot"|"aged boot") ;;
  *) echo "qualification stage must be first boot or aged boot" >&2; exit 64 ;;
esac
[[ "$VM_NAME" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]]

cleanup() {
  tart stop "$VM_NAME" 2>/dev/null || true
  if [ -n "$VM_PID" ]; then
    kill "$VM_PID" 2>/dev/null || true
    wait "$VM_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "::group::$QUALIFICATION_STAGE E2E image qualification"
tart run --no-graphics "$VM_NAME" >"/tmp/${VM_NAME}-${QUALIFICATION_STAGE// /-}.log" 2>&1 &
VM_PID=$!

VM_IP=""
for _ in $(seq 1 90); do
  VM_IP="$(tart ip "$VM_NAME" 2>/dev/null || true)"
  if [ -n "$VM_IP" ]; then break; fi
  kill -0 "$VM_PID" 2>/dev/null
  sleep 5
done
if [ -z "$VM_IP" ]; then
  echo "::error::$QUALIFICATION_STAGE VM did not obtain an IP"
  exit 1
fi

for _ in $(seq 1 60); do
  if env SSH_PASSWORD="$SSH_PASSWORD" bash ops/images/ssh-vm.sh \
    "nixmac_e2e@$VM_IP" true 2>/dev/null; then
    break
  fi
  kill -0 "$VM_PID" 2>/dev/null
  sleep 5
done
if ! env SSH_PASSWORD="$SSH_PASSWORD" bash ops/images/ssh-vm.sh \
  "nixmac_e2e@$VM_IP" true 2>/dev/null; then
  echo "::error::$QUALIFICATION_STAGE VM did not accept dedicated-user SSH"
  exit 1
fi

# Auto-login must have produced the Aqua session before the app-owned
# Accessibility and ScreenCapture smoke can be meaningful.
for _ in $(seq 1 60); do
  # Expand uid in the remote VM, not the builder.
  # shellcheck disable=SC2016
  if env SSH_PASSWORD="$SSH_PASSWORD" bash ops/images/ssh-vm.sh \
    "nixmac_e2e@$VM_IP" \
    'uid="$(id -u)"; launchctl print "gui/$uid" >/dev/null 2>&1' 2>/dev/null; then
    break
  fi
  sleep 5
done
env SSH_PASSWORD="$SSH_PASSWORD" bash ops/images/ssh-vm.sh \
  "nixmac_e2e@$VM_IP" \
  '/usr/local/libexec/qualify-nixmac-e2e-runner'
echo "::endgroup::"
