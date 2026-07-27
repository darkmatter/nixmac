#!/bin/bash
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SERVICE_USER=""
RUNNER_APP_ID=""
HOST_ID=""
CONTRACT=""
ATTESTOR_KEY=""
RUNNER_KEY=""
INVENTORY_KEY=""
SINK_KEY=""
REGISTRY_USERNAME=""
REGISTRY_TOKEN_FILE=""
NODE_BINARY="/opt/homebrew/bin/node"

usage() {
  echo "usage: sudo install-cilicon-e2e-host.sh --service-user USER --runner-app-id ID --host-id ID --contract FILE --attestor-key FILE --runner-key FILE --inventory-key FILE --sink-key FILE --registry-username USER --registry-token-file FILE" >&2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --service-user) SERVICE_USER="$2"; shift 2 ;;
    --runner-app-id) RUNNER_APP_ID="$2"; shift 2 ;;
    --host-id) HOST_ID="$2"; shift 2 ;;
    --contract) CONTRACT="$2"; shift 2 ;;
    --attestor-key) ATTESTOR_KEY="$2"; shift 2 ;;
    --runner-key) RUNNER_KEY="$2"; shift 2 ;;
    --inventory-key) INVENTORY_KEY="$2"; shift 2 ;;
    --sink-key) SINK_KEY="$2"; shift 2 ;;
    --registry-username) REGISTRY_USERNAME="$2"; shift 2 ;;
    --registry-token-file) REGISTRY_TOKEN_FILE="$2"; shift 2 ;;
    *) usage; exit 64 ;;
  esac
done

if [ "$(id -u)" -ne 0 ]; then
  usage
  exit 64
fi
[[ "$SERVICE_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]]
[[ "$RUNNER_APP_ID" =~ ^[1-9][0-9]*$ ]]
[[ "$HOST_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]]
[[ "$REGISTRY_USERNAME" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]]
service_uid="$(id -u "$SERVICE_USER")"
service_home="$(dscl . -read "/Users/$SERVICE_USER" NFSHomeDirectory | sed 's/^NFSHomeDirectory: //')"
test -d "$service_home"
test -x /opt/homebrew/bin/tart
for file in "$CONTRACT" "$ATTESTOR_KEY" "$RUNNER_KEY" "$INVENTORY_KEY" "$SINK_KEY" "$REGISTRY_TOKEN_FILE"; do
  test -f "$file" && test ! -L "$file"
done
token_owner="$(/usr/bin/stat -f '%u' "$REGISTRY_TOKEN_FILE")"
token_mode="$(/usr/bin/stat -f '%Lp' "$REGISTRY_TOKEN_FILE")"
test "$token_owner" -eq 0
test "$token_mode" = "600"
test -s "$REGISTRY_TOKEN_FILE"
for command in python3 plutil visudo xcrun; do
  command -v "$command" >/dev/null
done
test -x "$NODE_BINARY"
test ! -e /var/db/nixmac-e2e-quarantined

"$NODE_BINARY" --input-type=module - \
  "$CONTRACT" \
  "$ATTESTOR_KEY" \
  "$RUNNER_KEY" \
  "$INVENTORY_KEY" \
  "$SINK_KEY" \
  "$SCRIPT_DIR/cilicon-e2e-contract.mjs" <<'NODE'
import {
  createPrivateKey,
  createPublicKey,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const [contractPath, attestorPath, ...rsaPaths] = process.argv.slice(2, 7);
const modulePath = process.argv[7];
const { validateProviderContract } = await import(pathToFileURL(modulePath));
const contract = validateProviderContract(JSON.parse(readFileSync(contractPath, "utf8")));
if (!["shadow-qualified-v1", "production-qualified-v1"].includes(contract.activation.state)) {
  throw new Error("host installation requires a qualified provider contract");
}
const attestorPrivate = createPrivateKey(readFileSync(attestorPath, "utf8"));
const attestorPublic = createPublicKey(contract.qualification.attestor.publicKeyPem);
if (
  attestorPrivate.asymmetricKeyType !== "ed25519" ||
  attestorPublic.asymmetricKeyType !== "ed25519" ||
  !createPublicKey(attestorPrivate)
    .export({ type: "spki", format: "der" })
    .equals(attestorPublic.export({ type: "spki", format: "der" }))
) {
  throw new Error("attestor private key does not match the qualified public key");
}
for (const file of rsaPaths) {
  if (createPrivateKey(readFileSync(file, "utf8")).asymmetricKeyType !== "rsa") {
    throw new Error(`${file} is not an RSA GitHub App key`);
  }
}
NODE

# Cilicon 2.4.2 has no registry-credential field. Authenticate only this
# one-time Tart pull through stdin, then configure Cilicon against the complete
# local digest cache. The token is never placed in argv, the Tart image, the
# launchd environment, or the long-lived host credential directory.
image_reference="$(
  "$NODE_BINARY" --input-type=module - "$CONTRACT" <<'NODE'
import { readFileSync } from "node:fs";
const contract = JSON.parse(readFileSync(process.argv[2], "utf8"));
process.stdout.write(contract.qualification.image.reference);
NODE
)"
if [[ ! "$image_reference" =~ ^ghcr\.io/([^@]+)@(sha256:[0-9a-f]{64})$ ]]; then
  echo "runner image is not an immutable GHCR reference" >&2
  exit 65
fi
image_repository="${BASH_REMATCH[1]}"
image_digest="${BASH_REMATCH[2]}"
prewarm_vm="nixmac-e2e-prewarm-$(/usr/bin/uuidgen | tr '[:upper:]' '[:lower:]')"
cleanup_install() {
  if [ -n "$prewarm_vm" ]; then
    /usr/bin/sudo -u "$SERVICE_USER" /usr/bin/env HOME="$service_home" \
      /opt/homebrew/bin/tart delete "$prewarm_vm" >/dev/null 2>&1 || true
  fi
}
trap cleanup_install EXIT

# The service shell reads the short-lived package token from stdin. Tart
# supports these environment variables without persisting them to Keychain.
# shellcheck disable=SC2024 # Root must open the root-only token file before sudo changes user.
/usr/bin/sudo -H -u "$SERVICE_USER" /bin/bash -c '
  set -euo pipefail
  registry_username="$1"
  image_reference="$2"
  IFS= read -r TART_REGISTRY_PASSWORD || test -n "$TART_REGISTRY_PASSWORD"
  test -n "$TART_REGISTRY_PASSWORD"
  export TART_REGISTRY_USERNAME="$registry_username"
  export TART_REGISTRY_PASSWORD
  exec /opt/homebrew/bin/tart pull "$image_reference"
' _ "$REGISTRY_USERNAME" "$image_reference" < "$REGISTRY_TOKEN_FILE"

# Tart and Cilicon share the service user's ~/.tart/cache/OCIs layout. This
# clone runs without registry credentials and proves the complete digest cache
# is sufficient before launchd starts the first cycle.
/usr/bin/sudo -u "$SERVICE_USER" /usr/bin/env HOME="$service_home" \
  /opt/homebrew/bin/tart clone "$image_reference" "$prewarm_vm"
cache_path="$service_home/.tart/cache/OCIs/ghcr.io/$image_repository/$image_digest"
test -d "$cache_path" && test ! -L "$cache_path"
for cache_file in config.json disk.img manifest.json nvram.bin; do
  test -s "$cache_path/$cache_file" && test ! -L "$cache_path/$cache_file"
done
for unfinished_marker in UNFINISHED .unfinished; do
  test ! -e "$cache_path/$unfinished_marker"
done
/usr/bin/sudo -u "$SERVICE_USER" /usr/bin/env HOME="$service_home" \
  /opt/homebrew/bin/tart delete "$prewarm_vm"
prewarm_vm=""

/bin/bash "$SCRIPT_DIR/install-cilicon-v2.4.2.sh"
test -x /Applications/Cilicon.app/Contents/MacOS/Cilicon

install -d -o root -g wheel -m 0755 \
  "/Library/Application Support/darkmatter" \
  /usr/local/libexec
install -d -o "$SERVICE_USER" -g staff -m 0700 \
  "/Library/Application Support/darkmatter/credentials" \
  /private/var/db/nixmac-e2e-host \
  /private/var/db/nixmac-e2e-host/cycles \
  /private/var/db/nixmac-e2e-host/history \
  /Users/Shared/Cilicon \
  /Users/Shared/Cilicon/vms \
  /Users/Shared/nixmac-e2e-host \
  /Users/Shared/nixmac-e2e-host/logs

install -o root -g wheel -m 0644 \
  "$CONTRACT" \
  "/Library/Application Support/darkmatter/nixmac-e2e-runner.contract.json"
for source_and_name in \
  "$ATTESTOR_KEY:e2e-attestor-ed25519.pem" \
  "$RUNNER_KEY:e2e-runner-app.pem" \
  "$INVENTORY_KEY:e2e-inventory-app.pem" \
  "$SINK_KEY:e2e-sink-app.pem"; do
  source="${source_and_name%:*}"
  name="${source_and_name##*:}"
  install -o "$SERVICE_USER" -g staff -m 0600 \
    "$source" \
    "/Library/Application Support/darkmatter/credentials/$name"
done

for executable in \
  cilicon-e2e-cycle-wrapper.sh \
  cilicon-e2e-lifecycle-attestor.sh \
  cilicon-e2e-host.mjs; do
  install -o root -g wheel -m 0755 "$SCRIPT_DIR/$executable" "/usr/local/libexec/$executable"
done
install -o root -g wheel -m 0755 \
  "$SCRIPT_DIR/nixmac-e2e-mark-quarantine.sh" \
  /usr/local/libexec/nixmac-e2e-mark-quarantine
install -o root -g wheel -m 0644 \
  "$SCRIPT_DIR/cilicon-e2e-contract.mjs" \
  /usr/local/libexec/cilicon-e2e-contract.mjs
if [ -d /Applications/Xcode.app/Contents/Developer ]; then
  apple_developer_dir="/Applications/Xcode.app/Contents/Developer"
elif [ -d /Library/Developer/CommandLineTools ]; then
  apple_developer_dir="/Library/Developer/CommandLineTools"
else
  echo "Apple Xcode or Command Line Tools are required" >&2
  exit 69
fi
/usr/bin/env -i \
  HOME=/private/var/root \
  PATH=/usr/bin:/bin:/usr/sbin:/sbin \
  DEVELOPER_DIR="$apple_developer_dir" \
  /usr/bin/xcrun --sdk macosx swiftc -O \
  "$SCRIPT_DIR/cilicon-e2e-graceful-quit.swift" \
  -o /usr/local/libexec/cilicon-e2e-graceful-quit
chown root:wheel /usr/local/libexec/cilicon-e2e-graceful-quit
chmod 0755 /usr/local/libexec/cilicon-e2e-graceful-quit

sudoers="/etc/sudoers.d/nixmac-e2e-quarantine"
printf '%s ALL=(root) NOPASSWD: /usr/local/libexec/nixmac-e2e-mark-quarantine\n' \
  "$SERVICE_USER" > "$sudoers"
chown root:wheel "$sudoers"
chmod 0440 "$sudoers"
visudo -cf "$sudoers"

newsyslog="/etc/newsyslog.d/nixmac-e2e.conf"
{
  printf '%s %s:staff 640 10 10240 * J\n' \
    "/Users/Shared/nixmac-e2e-host/logs/cycle.log" \
    "$SERVICE_USER"
  printf '%s %s:staff 640 10 10240 * J\n' \
    "/Users/Shared/nixmac-e2e-host/logs/cycle.error.log" \
    "$SERVICE_USER"
} > "$newsyslog"
chown root:wheel "$newsyslog"
chmod 0644 "$newsyslog"

launch_agents="$service_home/Library/LaunchAgents"
install -d -o "$SERVICE_USER" -g staff -m 0755 "$launch_agents"
temporary_plist="$(mktemp /private/tmp/nixmac-e2e-cycle.XXXXXX.plist)"
cp "$SCRIPT_DIR/com.darkmatter.nixmac-e2e-cycle.plist" "$temporary_plist"
/usr/libexec/PlistBuddy \
  -c "Add :EnvironmentVariables:NIXMAC_E2E_RUNNER_APP_ID string $RUNNER_APP_ID" \
  "$temporary_plist"
/usr/libexec/PlistBuddy \
  -c "Add :EnvironmentVariables:NIXMAC_E2E_HOST_ID string $HOST_ID" \
  "$temporary_plist"
/usr/libexec/PlistBuddy \
  -c "Add :EnvironmentVariables:NIXMAC_E2E_NODE_BINARY string $NODE_BINARY" \
  "$temporary_plist"
/usr/libexec/PlistBuddy \
  -c "Add :EnvironmentVariables:NIXMAC_E2E_IMAGE_CACHE_ROOT string $service_home/.tart/cache/OCIs" \
  "$temporary_plist"
plutil -lint "$temporary_plist"
target_plist="$launch_agents/com.darkmatter.nixmac-e2e-cycle.plist"
install -o "$SERVICE_USER" -g staff -m 0644 "$temporary_plist" "$target_plist"
rm -f "$temporary_plist"

if ! launchctl print "gui/$service_uid" >/dev/null 2>&1; then
  echo "service user must have a logged-in Aqua session before launch" >&2
  exit 69
fi
launchctl bootout "gui/$service_uid/com.darkmatter.nixmac-e2e-cycle" 2>/dev/null || true
launchctl bootstrap "gui/$service_uid" "$target_plist"
launchctl enable "gui/$service_uid/com.darkmatter.nixmac-e2e-cycle"
launchctl kickstart -k "gui/$service_uid/com.darkmatter.nixmac-e2e-cycle"
launchctl print "gui/$service_uid/com.darkmatter.nixmac-e2e-cycle" >/dev/null

echo "Installed and started capacity-one Cilicon E2E host $HOST_ID."
