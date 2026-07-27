#!/bin/bash
set -euo pipefail

# Apple's RFC1918 address allowlist applies to every program on the dedicated
# host, so this direct SSH probe exercises the same Local Network policy path
# as Packer. If this succeeds and Packer later times out, the divergence points
# away from host Local Network privacy and toward Packer itself.

: "${BASE_IMAGE_DIGEST:?BASE_IMAGE_DIGEST is required}"
if [[ ! "$BASE_IMAGE_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "::error::BASE_IMAGE_DIGEST must be an immutable sha256 digest"
  exit 1
fi
readonly BASE_IMAGE="ghcr.io/cirruslabs/macos-tahoe-base@$BASE_IMAGE_DIGEST"
readonly RUN_SUFFIX="${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
readonly VM_NAME="nixmac-base-connectivity-${RUN_SUFFIX//[^A-Za-z0-9_.-]/-}"
START_EPOCH="$(date +%s)"
readonly START_EPOCH

vm_pid=""
# Invoked indirectly by the EXIT trap.
# shellcheck disable=SC2329
cleanup() {
  tart stop "$VM_NAME" 2>/dev/null || true
  if [ -n "$vm_pid" ]; then
    kill "$vm_pid" 2>/dev/null || true
    wait "$vm_pid" 2>/dev/null || true
  fi
  tart delete "$VM_NAME" 2>/dev/null || true
}
trap cleanup EXIT

print_host_diagnostics() {
  echo "::group::Host connectivity diagnostics"
  echo "UTC: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Runner name: ${RUNNER_NAME:-unset}"
  echo "Process ancestry:"
  current_pid="$$"
  for _ in $(seq 1 12); do
    /bin/ps -o pid=,ppid=,user=,command= -p "$current_pid" 2>/dev/null || true
    parent_pid="$(/bin/ps -o ppid= -p "$current_pid" 2>/dev/null | tr -d '[:space:]')"
    case "$parent_pid" in
      ''|0|1) break ;;
    esac
    current_pid="$parent_pid"
  done
  echo "Runner LaunchAgents:"
  for plist in "$HOME"/Library/LaunchAgents/actions.runner.*.plist; do
    if [ -f "$plist" ]; then
      label="$(/usr/bin/plutil -extract Label raw -o - "$plist" 2>/dev/null || true)"
      echo "$plist label=${label:-unknown}"
      if [ -n "$label" ]; then
        /bin/launchctl print "gui/$(id -u)/$label" 2>&1 |
          sed -n '1,80p' || true
      fi
    fi
  done
  echo "bridge100:"
  /sbin/ifconfig bridge100 2>&1 || true
  echo "ARP table:"
  /usr/sbin/arp -an 2>&1 || true
  echo "Recent Local Network diagnostics:"
  /usr/bin/log show --last 5m --style compact \
    --predicate 'eventMessage CONTAINS[c] "local network" OR subsystem CONTAINS[c] "network"' \
    2>&1 | tail -300 || true
  echo "::endgroup::"
}

print_guest_diagnostics() {
  echo "::group::Guest diagnostics through Tart guest agent"
  tart exec "$VM_NAME" /usr/bin/sw_vers 2>&1 || true
  tart exec "$VM_NAME" /sbin/ifconfig 2>&1 || true
  tart exec "$VM_NAME" /bin/launchctl print system/com.openssh.sshd 2>&1 |
    sed -n '1,160p' || true
  tart exec "$VM_NAME" /usr/sbin/netstat -an 2>&1 |
    grep '[.:]22[[:space:]]' || true
  echo "::endgroup::"
}

tart delete "$VM_NAME" 2>/dev/null || true
echo "Cloning exact base image: $BASE_IMAGE"
tart clone "$BASE_IMAGE" "$VM_NAME"
tart run --no-graphics "$VM_NAME" &>"/tmp/${VM_NAME}.log" &
vm_pid=$!

guest_agent_epoch=""
dhcp_ip=""
dhcp_epoch=""
arp_ip=""
arp_epoch=""
tcp_state="not-attempted"
ssh_state="not-attempted"
probe_log="/tmp/${VM_NAME}-nc.log"

for _ in $(seq 1 60); do
  now_epoch="$(date +%s)"
  elapsed="$((now_epoch - START_EPOCH))"

  if [ -z "$guest_agent_epoch" ] && tart exec "$VM_NAME" /usr/bin/true >/dev/null 2>&1; then
    guest_agent_epoch="$elapsed"
    echo "Tart guest agent became ready at +${elapsed}s"
  fi

  if [ -z "$dhcp_ip" ]; then
    candidate="$(tart ip "$VM_NAME" 2>/dev/null || true)"
    if [ -n "$candidate" ]; then
      dhcp_ip="$candidate"
      dhcp_epoch="$elapsed"
      echo "DHCP resolver returned $dhcp_ip at +${elapsed}s"
    fi
  fi
  if [ -z "$arp_ip" ]; then
    candidate="$(tart ip --resolver=arp "$VM_NAME" 2>/dev/null || true)"
    if [ -n "$candidate" ]; then
      arp_ip="$candidate"
      arp_epoch="$elapsed"
      echo "ARP resolver returned $arp_ip at +${elapsed}s"
    fi
  fi

  vm_ip="${dhcp_ip:-$arp_ip}"
  if [ -n "$vm_ip" ]; then
    if /usr/bin/nc -v -G 2 -z "$vm_ip" 22 >"$probe_log" 2>&1; then
      tcp_state="reachable"
      if env SSH_PASSWORD=admin bash ops/images/ssh-vm.sh "admin@$vm_ip" true >/dev/null 2>&1; then
        ssh_state="authenticated"
        {
          echo "## Base-image connectivity gate"
          echo ""
          echo "Qualified \`$BASE_IMAGE\` before Packer."
          echo ""
          echo "- Guest agent ready: +${guest_agent_epoch:-unknown}s"
          echo "- DHCP IP: ${dhcp_ip:-none} at +${dhcp_epoch:-unknown}s"
          echo "- ARP IP: ${arp_ip:-none} at +${arp_epoch:-unknown}s"
          echo "- TCP/22: reachable"
          echo "- SSH admin/password: authenticated"
        } | tee -a "${GITHUB_STEP_SUMMARY:?GITHUB_STEP_SUMMARY is required}"
        exit 0
      fi
      ssh_state="authentication-failed"
    elif grep -qi 'refused' "$probe_log"; then
      tcp_state="connection-refused"
    elif grep -Eqi 'timed out|no route|unreachable' "$probe_log"; then
      tcp_state="timeout-or-no-route"
    else
      tcp_state="unreachable"
    fi
  fi
  sleep 5
done

echo "::error::Base-image connectivity gate failed after 5 minutes"
guest_state="not-ready"
if [ -n "$guest_agent_epoch" ]; then
  guest_state="ready-at-${guest_agent_epoch}s"
fi
echo "classification: guest_agent=$guest_state dhcp=${dhcp_ip:-none} arp=${arp_ip:-none} tcp=$tcp_state ssh=$ssh_state"
if [ -f "$probe_log" ]; then
  sed -n '1,80p' "$probe_log"
fi
if [ -f "/tmp/${VM_NAME}.log" ]; then
  echo "::group::Tart run log"
  tail -200 "/tmp/${VM_NAME}.log"
  echo "::endgroup::"
fi
print_guest_diagnostics
print_host_diagnostics
exit 1
