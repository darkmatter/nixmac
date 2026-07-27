#!/bin/bash
set -euo pipefail

summary_path="${GITHUB_STEP_SUMMARY:?GITHUB_STEP_SUMMARY is required}"

tools_base="${RUNNER_TOOL_CACHE:-${HOME:?HOME is required}/.local/share}"
tools_root="$tools_base/nixmac-image-builder"
bin_dir="$tools_root/bin"
artifacts_dir="/Users/Shared/nixmac-image-builder"
mkdir -p "$tools_root"
tmp_dir="$(mktemp -d "$tools_root/.preflight.XXXXXX")"
hashes_file="$tmp_dir/xcode-hashes.txt"
policy_plist="$tmp_dir/local-network-policy.plist"
pending_marker="$tools_root/network-config-reboot-pending.json"
observed_marker="$tools_root/network-config-reboot-observed.json"
trap 'rm -rf "$tmp_dir"' EXIT
export PATH="$bin_dir:$PATH"

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

{
  echo "## macOS image builder preflight"
  echo ""
  echo '```text'
  sw_vers
  uname -m
  echo "Logical CPUs: $(/usr/sbin/sysctl -n hw.ncpu)"
  echo "Physical memory bytes: $(/usr/sbin/sysctl -n hw.memsize)"
  echo "Boot epoch: $boot_epoch"
  echo "Runner name: ${RUNNER_NAME:-unset}"
  echo "Runner user: $(id -un)"
  echo "Runner UID: $(id -u)"
  /usr/bin/xcodebuild -version 2>/dev/null || true
  command -v tart || true
  tart --version 2>/dev/null || true
  command -v packer || true
  command -v oras || true
  echo "Tool root: $tools_root"
  echo "Xcode artifact staging: $artifacts_dir"
  sysctl -n kern.hv_support 2>/dev/null || true
  df -h /
  echo '```'
} | tee -a "$summary_path"

echo "Runner process ancestry:"
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

if [ "$(sysctl -n kern.hv_support 2>/dev/null || true)" != "1" ]; then
  echo "::error::Apple virtualization support is unavailable on the dedicated image builder"
  exit 1
fi
if [ "$(uname -m)" != "arm64" ]; then
  echo "::error::Tart image builds require an Apple Silicon image builder"
  exit 1
fi
for tool in tart packer oras; do
  if ! command -v "$tool" >/dev/null; then
    echo "::error::$tool is not provisioned on the dedicated image builder"
    exit 1
  fi
done

if ! sudo -n /usr/bin/defaults export com.apple.network.local-network - |
  /bin/cat > "$policy_plist"; then
  echo "::error::Cannot read the dedicated host Local Network policy"
  echo "::error::Install the scoped sudoers artifact, then dispatch image-builder-network-config"
  exit 1
fi
expected_json='["10.0.0.0/8","172.16.0.0/12","192.168.0.0/16"]'
ethernet_json="$(
  /usr/bin/plutil -extract AllowedEthernetLocalNetworkAddresses json -o - "$policy_plist" 2>/dev/null |
    tr -d '[:space:]' |
    sed 's#\\/#/#g' || true
)"
wifi_json="$(
  /usr/bin/plutil -extract AllowedWiFiLocalNetworkAddresses json -o - "$policy_plist" 2>/dev/null |
    tr -d '[:space:]' |
    sed 's#\\/#/#g' || true
)"
if [ "$ethernet_json" != "$expected_json" ] || [ "$wifi_json" != "$expected_json" ]; then
  echo "::error::Local Network policy is not the exact approved RFC1918 set"
  echo "::error::Dispatch image-builder-network-config before image-builder-preflight or image-builder"
  exit 1
fi

if [ -f "$pending_marker" ]; then
  previous_boot_epoch="$(
    /usr/bin/plutil -extract previous_boot_epoch raw -o - "$pending_marker" 2>/dev/null || true
  )"
  case "$previous_boot_epoch" in
    ''|*[!0-9]*)
      echo "::error::Pending reboot marker has an invalid previous_boot_epoch"
      echo "::error::Dispatch image-builder-network-config to replace it and schedule a safe reboot"
      exit 1
      ;;
  esac
  if [ "$boot_epoch" -le "$previous_boot_epoch" ]; then
    echo "::error::Local Network configuration is pending a verified host reboot"
    exit 1
  fi
  /usr/bin/plutil -replace observed_boot_epoch -integer "$boot_epoch" "$pending_marker"
  /usr/bin/plutil -replace observed_at_utc -string "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "$pending_marker"
  mv "$pending_marker" "$observed_marker"
  {
    echo ""
    echo "## Verified maintenance reboot"
    echo ""
    echo "Boot epoch advanced from \`$previous_boot_epoch\` to \`$boot_epoch\`."
  } | tee -a "$summary_path"
elif [ -f "$observed_marker" ]; then
  observed_previous_epoch="$(
    /usr/bin/plutil -extract previous_boot_epoch raw -o - "$observed_marker" 2>/dev/null || true
  )"
  observed_boot_epoch="$(
    /usr/bin/plutil -extract observed_boot_epoch raw -o - "$observed_marker" 2>/dev/null || true
  )"
  if ! [[ "$observed_previous_epoch" =~ ^[0-9]+$ ]] ||
    ! [[ "$observed_boot_epoch" =~ ^[0-9]+$ ]] ||
    [ "$observed_boot_epoch" -le "$observed_previous_epoch" ]; then
    echo "::error::Observed reboot marker does not prove a later activation boot"
    echo "::error::Dispatch image-builder-network-config to replace it and schedule a safe reboot"
    exit 1
  fi
else
  echo "::error::Exact Local Network policy has no activation-reboot evidence"
  echo "::error::Dispatch image-builder-network-config to create evidence and schedule a safe reboot"
  exit 1
fi

{
  echo ""
  echo "## Local Network policy"
  echo ""
  echo "Exact RFC1918 allowlist verified for Ethernet and Wi-Fi."
} | tee -a "$summary_path"

echo "Checking deterministic Xcode staging locations..."
candidates="$(
  for candidate in \
    "$artifacts_dir"/Xcode*.xip \
    "$artifacts_dir"/Xcode*.pkg \
    /Users/Shared/Xcode*.xip \
    /Users/Shared/Xcode*.pkg \
    /Users/*/Xcode*.xip \
    /Users/*/Xcode*.pkg \
    /private/var/tmp/Xcode*.xip \
    /private/var/tmp/Xcode*.pkg; do
    if [ -f "$candidate" ]; then
      printf '%s\n' "$candidate"
    fi
  done | sort -u
)"

if [ -z "$candidates" ]; then
  {
    echo ""
    echo "## Approved artifact candidates"
    echo ""
    echo "(none found)"
  } >> "$summary_path"
  echo "::error::No Xcode .xip or .pkg found in $artifacts_dir, /Users/Shared, a home root, or /private/var/tmp"
  exit 1
fi

while IFS= read -r candidate; do
  echo "Hashing $candidate"
  shasum -a 256 "$candidate" | tee -a "$hashes_file"
done <<< "$candidates"

{
  echo ""
  echo "## Approved artifact candidates"
  echo ""
  echo '```text'
  cat "$hashes_file"
  echo '```'
} >> "$summary_path"
