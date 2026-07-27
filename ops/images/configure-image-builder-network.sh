#!/bin/bash
set -euo pipefail

# Dedicated-host maintenance only. Apple's documented RFC1918 allowlist makes
# these addresses reachable by every process on the host, not only Tart or
# Packer. This deliberate Local Network privacy relaxation is acceptable only
# on the single-purpose nixmac image builder.

readonly POLICY_DOMAIN="com.apple.network.local-network"
readonly ETHERNET_KEY="AllowedEthernetLocalNetworkAddresses"
readonly WIFI_KEY="AllowedWiFiLocalNetworkAddresses"
readonly EXPECTED_JSON='["10.0.0.0/8","172.16.0.0/12","192.168.0.0/16"]'
RUNNER_USER="$(id -un)"
readonly RUNNER_USER
RUNNER_UID="$(id -u)"
readonly RUNNER_UID

: "${RUNNER_NAME:?RUNNER_NAME is required; run only on the registered image-builder runner}"
: "${GITHUB_STEP_SUMMARY:?GITHUB_STEP_SUMMARY is required}"

tools_base="${RUNNER_TOOL_CACHE:-${HOME:?HOME is required}/.local/share}"
state_dir="$tools_base/nixmac-image-builder"
pending_marker="$state_dir/network-config-reboot-pending.json"
observed_marker="$state_dir/network-config-reboot-observed.json"
mkdir -p "$state_dir"

policy_export() {
  local output="$1"
  if ! sudo -n /usr/bin/defaults export "$POLICY_DOMAIN" - |
    /bin/cat > "$output"; then
    /usr/bin/plutil -create xml1 "$output"
  fi
}

policy_value() {
  local plist="$1"
  local key="$2"
  /usr/bin/plutil -extract "$key" json -o - "$plist" |
    tr -d '[:space:]' |
    sed 's#\\/#/#g'
}

policy_is_exact() {
  local plist="$1"
  [ "$(policy_value "$plist" "$ETHERNET_KEY" 2>/dev/null || true)" = "$EXPECTED_JSON" ] &&
    [ "$(policy_value "$plist" "$WIFI_KEY" 2>/dev/null || true)" = "$EXPECTED_JSON" ]
}

require_sudo_command() {
  if ! sudo -n -l "$@" >/dev/null 2>&1; then
    echo "::error::Missing argv-scoped privileged permission: $*"
    echo "::error::Install ops/images/sudoers.d/nixmac-image-builder-network as a one-time root host artifact"
    exit 1
  fi
}

sudo_listing="$(sudo -n -l 2>/dev/null || true)"
if printf '%s\n' "$sudo_listing" | grep -Eq 'NOPASSWD:[[:space:]]*ALL([[:space:]]|$)'; then
  echo "::error::Refusing to configure a public-repository runner with blanket NOPASSWD: ALL"
  exit 1
fi

require_sudo_command /usr/bin/defaults export "$POLICY_DOMAIN" -
require_sudo_command /usr/bin/defaults read /Library/Preferences/com.apple.loginwindow autoLoginUser
require_sudo_command /usr/bin/fdesetup status
require_sudo_command /usr/bin/defaults write "$POLICY_DOMAIN" "$ETHERNET_KEY" \
  -array 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16
require_sudo_command /usr/bin/defaults write "$POLICY_DOMAIN" "$WIFI_KEY" \
  -array 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16
require_sudo_command /sbin/shutdown -r +2

matching_plists=()
for plist in "$HOME"/Library/LaunchAgents/actions.runner.*.plist; do
  if [ -f "$plist" ] && grep -Fq "$RUNNER_NAME" "$plist"; then
    matching_plists+=("$plist")
  fi
done
if [ "${#matching_plists[@]}" -ne 1 ]; then
  echo "::error::Expected exactly one loaded Actions runner LaunchAgent matching RUNNER_NAME=$RUNNER_NAME; found ${#matching_plists[@]}"
  exit 1
fi
runner_plist="${matching_plists[0]}"
runner_label="$(/usr/bin/plutil -extract Label raw -o - "$runner_plist")"
if ! /bin/launchctl print "gui/$RUNNER_UID/$runner_label" >/dev/null 2>&1; then
  echo "::error::Runner LaunchAgent $runner_label is not loaded in gui/$RUNNER_UID; refusing an unattended reboot"
  exit 1
fi

auto_login_user="$(
  sudo -n /usr/bin/defaults read /Library/Preferences/com.apple.loginwindow autoLoginUser |
    tr -d '[:space:]"' || true
)"
if [ "$auto_login_user" != "$RUNNER_USER" ]; then
  echo "::error::autoLoginUser must be $RUNNER_USER before unattended reboot; found ${auto_login_user:-unset}"
  exit 1
fi
filevault_status="$(sudo -n /usr/bin/fdesetup status)"
if [ "$filevault_status" != "FileVault is Off." ]; then
  echo "::error::FileVault must be Off before unattended reboot; found: $filevault_status"
  exit 1
fi

tmp_dir="$(mktemp -d "$state_dir/.network-config.XXXXXX")"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT
before_plist="$tmp_dir/before.plist"
after_plist="$tmp_dir/after.plist"
policy_export "$before_plist"

boot_epoch="$(
  /usr/sbin/sysctl -n kern.boottime |
    sed -E 's/^\{ sec = ([0-9]+).*/\1/'
)"
case "$boot_epoch" in
  ''|*[!0-9]*)
    echo "::error::Could not resolve current kern.boottime epoch"
    exit 1
    ;;
esac

persist_pending_marker() {
  local marker_tmp="$tmp_dir/network-config-reboot-pending.json"
  /usr/bin/plutil -create xml1 "$marker_tmp"
  /usr/bin/plutil -insert previous_boot_epoch -integer "$boot_epoch" "$marker_tmp"
  /usr/bin/plutil -insert observed_boot_epoch -integer 0 "$marker_tmp"
  /usr/bin/plutil -insert observed_at_utc -string pending "$marker_tmp"
  /usr/bin/plutil -insert runner_name -string "$RUNNER_NAME" "$marker_tmp"
  /usr/bin/plutil -insert runner_user -string "$RUNNER_USER" "$marker_tmp"
  /usr/bin/plutil -insert github_run_id -string "${GITHUB_RUN_ID:-unknown}" "$marker_tmp"
  /usr/bin/plutil -insert github_actor -string "${GITHUB_ACTOR:-unknown}" "$marker_tmp"
  /usr/bin/plutil -insert configured_at_utc -string "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "$marker_tmp"
  /usr/bin/plutil -convert json "$marker_tmp"
  mv "$marker_tmp" "$pending_marker"
}

if policy_is_exact "$before_plist"; then
  if [ -f "$pending_marker" ]; then
    previous_boot_epoch="$(
      /usr/bin/plutil -extract previous_boot_epoch raw -o - "$pending_marker" 2>/dev/null || true
    )"
    case "$previous_boot_epoch" in
      ''|*[!0-9]*)
        persist_pending_marker
        {
          echo "## Image-builder Local Network policy"
          echo ""
          echo "Replaced an invalid pending marker and scheduled a safe activation reboot."
        } | tee -a "$GITHUB_STEP_SUMMARY"
        sudo -n /sbin/shutdown -r +2
        exit 0
        ;;
    esac
    if [ "$boot_epoch" -le "$previous_boot_epoch" ]; then
      {
        echo "## Image-builder Local Network policy"
        echo ""
        echo "Policy is configured, but its required reboot is still pending."
        echo "A dedicated-host reboot is scheduled in two minutes."
      } | tee -a "$GITHUB_STEP_SUMMARY"
      sudo -n /sbin/shutdown -r +2
      exit 0
    fi
    {
      echo "## Image-builder Local Network policy"
      echo ""
      echo "Policy is configured and the maintenance reboot has occurred."
      echo "The pending marker is retained for preflight verification."
    } | tee -a "$GITHUB_STEP_SUMMARY"
    exit 0
  fi
  if [ -f "$observed_marker" ]; then
    observed_previous_epoch="$(
      /usr/bin/plutil -extract previous_boot_epoch raw -o - "$observed_marker" 2>/dev/null || true
    )"
    observed_boot_epoch="$(
      /usr/bin/plutil -extract observed_boot_epoch raw -o - "$observed_marker" 2>/dev/null || true
    )"
    if [[ "$observed_previous_epoch" =~ ^[0-9]+$ ]] &&
      [[ "$observed_boot_epoch" =~ ^[0-9]+$ ]] &&
      [ "$observed_boot_epoch" -gt "$observed_previous_epoch" ]; then
      {
        echo "## Image-builder Local Network policy"
        echo ""
        echo "Already configured exactly with an observed activation reboot; no reboot scheduled."
      } | tee -a "$GITHUB_STEP_SUMMARY"
      exit 0
    fi
    echo "::warning::Observed reboot marker is invalid; replacing it with fresh pending evidence"
  fi
  persist_pending_marker
  {
    echo "## Image-builder Local Network policy"
    echo ""
    echo "Policy already matches, but no activation-reboot evidence exists."
    echo "Created reboot marker: \`$pending_marker\`"
    echo "A dedicated-host activation reboot is scheduled in two minutes."
  } | tee -a "$GITHUB_STEP_SUMMARY"
  sudo -n /sbin/shutdown -r +2
  exit 0
fi

persist_pending_marker
sudo -n /usr/bin/defaults write "$POLICY_DOMAIN" "$ETHERNET_KEY" \
  -array 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16
sudo -n /usr/bin/defaults write "$POLICY_DOMAIN" "$WIFI_KEY" \
  -array 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16
policy_export "$after_plist"
if ! policy_is_exact "$after_plist"; then
  echo "::error::Local Network policy readback did not exactly match the approved RFC1918 set"
  exit 1
fi

{
  echo "## Image-builder Local Network policy"
  echo ""
  echo "Configured the exact RFC1918 allowlist and verified readback."
  echo "Reboot marker: \`$pending_marker\`"
  echo "A dedicated-host reboot is scheduled in two minutes."
  echo "If a job is interrupted, recover with \`tart stop nixmac-runner-tahoe || true\` then \`tart delete nixmac-runner-tahoe\` before retrying."
} | tee -a "$GITHUB_STEP_SUMMARY"

# The root-owned schedule survives Actions post-job cleanup. A different queued
# job could still be interrupted during this two-minute maintenance window.
sudo -n /sbin/shutdown -r +2
