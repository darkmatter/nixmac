#!/usr/bin/env bash
# tart-run.sh - run a command inside a tart VM over SSH.
#
# Usage:
#   tart-run.sh [--vm NAME] -- COMMAND...
#
# Flags:
#   --vm NAME    tart VM to drive (default: nixmac-tests)
#
# What it does, in order:
#   1. Verify the named VM exists locally (`tart list`).
#   2. Boot it if not already running; wait for IP + SSH.
#   3. On first contact, run ssh-copy-id (interactive password prompt; VM
#      default password is 'admin').
#   4. Run COMMAND over SSH with a TTY. Exit code = COMMAND's exit code.
#
# Stdout/stderr stream back to your terminal; the VM is transparent.
set -uo pipefail   # NOT -e: we forward COMMAND's exit code; die on our own errors

SSH_OPTS=(-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR)

die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# --- arg parsing ----------------------------------------------------------
VM="nixmac-tests"
COMMAND=()
while [ $# -gt 0 ]; do
  case "$1" in
    --vm)
      [ $# -ge 2 ] || die "--vm requires a name"
      VM="$2"; shift 2 ;;
    --)
      shift; COMMAND=("$@"); break ;;
    -h|--help)
      sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)
      die "unknown arg '$1' (did you forget '--' before the remote command?)" ;;
  esac
done

[ ${#COMMAND[@]} -gt 0 ] \
  || die "no command given. usage: tart-run.sh [--vm NAME] -- COMMAND..."

# --- preflight ------------------------------------------------------------
command -v tart >/dev/null 2>&1 \
  || die "tart not found. brew install cirruslabs/cli/tart"
# awk on column 2 (Name) for exact match; `grep -w` would false-positive on
# prefix-overlapping names like `nixmac-tart-tests-image` vs `…-image-backup`.
tart list 2>/dev/null | awk -v vm="$VM" '$2 == vm {f=1} END{exit !f}' \
  || die "VM '$VM' does not exist locally"

# --- bring the VM up + wait for SSH --------------------------------------
vm_running() {
  tart list 2>/dev/null | awk -v vm="$VM" '$2 == vm && /running/ {f=1} END{exit !f}'
}

if ! vm_running; then
  tart run "$VM" </dev/null >/tmp/tart-run-boot.log 2>&1 & disown
  for _ in $(seq 1 90); do vm_running && break; sleep 1; done
  vm_running || die "VM '$VM' did not start (see /tmp/tart-run-boot.log)"
fi

IP=""
for _ in $(seq 1 60); do
  IP="$(tart ip "$VM" 2>/dev/null || true)"
  [ -n "$IP" ] && break
  sleep 1
done
[ -n "$IP" ] || die "VM '$VM' did not get an IP"

for _ in $(seq 1 60); do
  nc -z -w 2 "$IP" 22 2>/dev/null && break
  sleep 1
done
nc -z -w 2 "$IP" 22 2>/dev/null || die "SSH on $IP:22 never came up"

# --- one-time passwordless SSH (interactive password prompt the first time) ---
if ! ssh "${SSH_OPTS[@]}" -o BatchMode=yes -o ConnectTimeout=5 "admin@$IP" true 2>/dev/null; then
  echo "tart-run.sh: setting up passwordless SSH (enter VM password 'admin' once)" >&2
  [ -f "$HOME/.ssh/id_ed25519" ] || [ -f "$HOME/.ssh/id_rsa" ] \
    || ssh-keygen -t ed25519 -N "" -f "$HOME/.ssh/id_ed25519" >/dev/null
  ssh-copy-id "${SSH_OPTS[@]}" "admin@$IP" >/dev/null || die "ssh-copy-id failed"
fi

# --- run COMMAND over SSH; preserve its exit code -------------------------
# printf '%q' shell-escapes each arg so multi-word commands with quoting
# survive the SSH word-splitting (ssh joins args with spaces on the remote).
remote_cmd=""
for arg in "${COMMAND[@]}"; do
  remote_cmd+=" $(printf '%q' "$arg")"
done

ssh -t "${SSH_OPTS[@]}" "admin@$IP" "$remote_cmd"
