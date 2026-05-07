#!/usr/bin/env bash
# shellcheck disable=SC2024
set -euo pipefail

# Start remote Codex app-server and nixmac for Computer Use E2E.
# Designed to be piped over SSH: cat remote-setup.sh | ssh ... 'bash -s'
#
# Required env vars (set by the workflow step before piping):
#   REMOTE_BACKUP        - Path for app-support backup
#   REMOTE_CONFIG        - Path for disposable nix config
#   REMOTE_KEY_FILE      - Path for OpenRouter API key file
#   REMOTE_AUTH_BACKUP   - Path for system.privilege.admin backup plist
#   REMOTE_APP_STAGE     - Path for staged app bundle directory
#   REMOTE_APP_TAR       - Path to uploaded app tarball
#   REMOTE_APP_PATH      - Expected path for the .app bundle
#   REMOTE_HOSTNAME      - Remote Mac hostname for nix config
#   NIXMAC_E2E_EVOLVE_PROVIDER
#   NIXMAC_E2E_EVOLVE_MODEL
#   NIXMAC_E2E_SUMMARY_PROVIDER
#   NIXMAC_E2E_SUMMARY_MODEL

cleanup_key_file() {
	if [[ -n "${REMOTE_KEY_FILE:-}" ]]; then
		rm -f "$REMOTE_KEY_FILE"
	fi
}
trap cleanup_key_file EXIT

auth_requires_user() {
	local plist_path="$1"
	/usr/bin/plutil -extract authenticate-user raw -o - "$plist_path" 2>/dev/null || true
}

pkill -f 'codex app-server --listen ws://127.0.0.1:18790' >/dev/null 2>&1 || true
pkill -f 'nixmac-activate-temp|with administrator privileges|/nix/store/.*/activate|ln -s /etc/static/pam.d/sudo_local /etc/pam.d/sudo_local' >/dev/null 2>&1 || true
osascript -e 'tell application id "com.darkmatter.nixmac" to quit' >/dev/null 2>&1 || true
pkill -x nixmac >/dev/null 2>&1 || true
sleep 2

rm -rf "$REMOTE_APP_STAGE"
mkdir -p "$REMOTE_APP_STAGE"
tar -xzf "$REMOTE_APP_TAR" -C "$REMOTE_APP_STAGE"
staged_app="$(find "$REMOTE_APP_STAGE" -maxdepth 1 -name "*.app" -type d | head -1)"
if [[ -z "$staged_app" ]]; then
	echo "error: PR-built app artifact did not contain a top-level .app bundle" >&2
	exit 1
fi
if [[ "$staged_app" != "$REMOTE_APP_PATH" ]]; then
	mv "$staged_app" "$REMOTE_APP_PATH"
fi
xattr -dr com.apple.quarantine "$REMOTE_APP_PATH" >/dev/null 2>&1 || true
rm -f "$REMOTE_APP_TAR"

if ! codesign --verify --deep --strict --verbose=2 "$REMOTE_APP_PATH"; then
	echo "error: PR-built bundle failed codesign verification; cleanup will remove the staged app bundle" >&2
	exit 1
fi

mkdir -p "$(dirname "$REMOTE_BACKUP")"
rm -rf "$REMOTE_BACKUP"
rm -f "${REMOTE_BACKUP}.state"
SUPPORT="$HOME/Library/Application Support/com.darkmatter.nixmac"
if [[ -d "$SUPPORT" ]]; then
	cp -pR "$SUPPORT" "$REMOTE_BACKUP"
	printf 'existed\n' >"${REMOTE_BACKUP}.state"
else
	printf 'absent\n' >"${REMOTE_BACKUP}.state"
fi

sudo -n security authorizationdb read system.privilege.admin >"$REMOTE_AUTH_BACKUP" 2>/tmp/nixmac-e2e-auth-read.err
if [[ "$(auth_requires_user "$REMOTE_AUTH_BACKUP")" != "true" ]]; then
	echo "error: refusing to start E2E because system.privilege.admin is not at the expected authenticated baseline" >&2
	exit 1
fi
sudo -n security authorizationdb write system.privilege.admin allow >/tmp/nixmac-e2e-auth-write.out 2>/tmp/nixmac-e2e-auth-write.err

GUI_UID="$(stat -f %u /dev/console 2>/dev/null || id -u)"
gui_launchctl() {
	if sudo -n launchctl asuser "$GUI_UID" launchctl "$@" >/dev/null 2>&1; then
		return 0
	fi
	echo "warning: could not run launchctl in gui/$GUI_UID; falling back to current bootstrap domain" >&2
	launchctl "$@" >/dev/null 2>&1 || true
}

python3 - <<'PY'
import json
import os

support = os.path.expanduser("~/Library/Application Support/com.darkmatter.nixmac")
os.makedirs(support, exist_ok=True)
settings_path = os.path.join(support, "settings.json")
try:
    with open(settings_path, "r", encoding="utf-8") as handle:
        settings = json.load(handle)
except FileNotFoundError:
    settings = {}
settings["confirmBuild"] = True
settings["confirmClear"] = True
settings["confirmRollback"] = True
settings["hostAttr"] = os.environ["REMOTE_HOSTNAME"]
settings["configDir"] = os.path.join(os.environ["REMOTE_CONFIG"], "config")
settings["evolveProvider"] = os.environ["NIXMAC_E2E_EVOLVE_PROVIDER"]
settings["evolveModel"] = os.environ["NIXMAC_E2E_EVOLVE_MODEL"]
settings["summaryProvider"] = os.environ["NIXMAC_E2E_SUMMARY_PROVIDER"]
settings["summaryModel"] = os.environ["NIXMAC_E2E_SUMMARY_MODEL"]
settings["sendDiagnostics"] = False
with open(settings_path, "w", encoding="utf-8") as handle:
    json.dump(settings, handle, indent=2, sort_keys=True)
    handle.write("\n")
PY

gui_launchctl unsetenv OPENROUTER_API_KEY
if [[ -s "${REMOTE_KEY_FILE:-}" ]]; then
	chmod 600 "$REMOTE_KEY_FILE"
	gui_launchctl setenv OPENROUTER_API_KEY "$(cat "$REMOTE_KEY_FILE")"
	rm -f "$REMOTE_KEY_FILE"
fi

nohup /Applications/Codex.app/Contents/Resources/codex app-server --listen ws://127.0.0.1:18790 >/tmp/nixmac-codex-app-server.log 2>&1 &
sleep 2

if ! open -n "$REMOTE_APP_PATH"; then
	echo "warning: open returned non-zero while launching $REMOTE_APP_PATH; continuing so Computer Use can inspect app state" >&2
fi
sleep 4
