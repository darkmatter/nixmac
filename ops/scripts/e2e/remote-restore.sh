#!/usr/bin/env bash
# shellcheck disable=SC2024
set +e

# Restore remote Mac state after Computer Use E2E.
# Designed to be piped over SSH: cat remote-restore.sh | ssh ... 'bash -s'
#
# Required env vars (set by the workflow step before piping):
#   REMOTE_BACKUP        - Path to app-support backup
#   REMOTE_CONFIG        - Path to disposable nix config
#   REMOTE_KEY_FILE      - Path for OpenRouter API key file
#   REMOTE_AUTH_BACKUP   - Path for system.privilege.admin backup plist
#   REMOTE_APP_STAGE     - Path to staged app bundle directory

cleanup_status=0

auth_requires_user() {
	local plist_path="$1"
	/usr/bin/plutil -extract authenticate-user raw -o - "$plist_path" 2>/dev/null || true
}

pkill -f 'nixmac-activate-temp|with administrator privileges|/nix/store/.*/activate|ln -s /etc/static/pam.d/sudo_local /etc/pam.d/sudo_local' >/dev/null 2>&1 || true
osascript -e 'tell application id "com.darkmatter.nixmac" to quit' >/dev/null 2>&1 || true
pkill -x nixmac >/dev/null 2>&1 || true
rm -f "$REMOTE_KEY_FILE"
rm -rf "$REMOTE_APP_STAGE" || cleanup_status=1

SUPPORT="$HOME/Library/Application Support/com.darkmatter.nixmac"
STATE=""
if [[ -n "$REMOTE_BACKUP" && -f "${REMOTE_BACKUP}.state" ]]; then
	STATE="$(cat "${REMOTE_BACKUP}.state")"
fi

GUI_UID="$(stat -f %u /dev/console 2>/dev/null || id -u)"
if ! sudo -n launchctl asuser "$GUI_UID" launchctl unsetenv OPENROUTER_API_KEY >/dev/null 2>&1; then
	launchctl unsetenv OPENROUTER_API_KEY >/dev/null 2>&1 || true
fi

if [[ -n "$REMOTE_AUTH_BACKUP" && -f "$REMOTE_AUTH_BACKUP" ]]; then
	if [[ "$(auth_requires_user "$REMOTE_AUTH_BACKUP")" != "true" ]]; then
		echo "error: refusing to restore system.privilege.admin from an unexpected backup" >&2
		cleanup_status=1
	elif ! sudo -n security authorizationdb write system.privilege.admin <"$REMOTE_AUTH_BACKUP" >/tmp/nixmac-e2e-auth-restore.out 2>/tmp/nixmac-e2e-auth-restore.err; then
		echo "error: failed to restore system.privilege.admin authorization policy" >&2
		cleanup_status=1
	fi
fi

current_auth="$(mktemp /tmp/nixmac-e2e-auth-current.XXXXXX)"
if sudo -n security authorizationdb read system.privilege.admin >"$current_auth" 2>/tmp/nixmac-e2e-auth-current.err; then
	if [[ "$(auth_requires_user "$current_auth")" != "true" ]]; then
		echo "error: system.privilege.admin did not return to authenticated baseline" >&2
		cleanup_status=1
	fi
else
	echo "error: could not read system.privilege.admin after cleanup" >&2
	cleanup_status=1
fi
rm -f "$current_auth"

if sudo -n launchctl asuser "$GUI_UID" launchctl getenv OPENROUTER_API_KEY >/tmp/nixmac-e2e-openrouter-env.out 2>/dev/null; then
	if [[ -s /tmp/nixmac-e2e-openrouter-env.out ]]; then
		echo "error: OPENROUTER_API_KEY still exists in GUI launchd environment after cleanup" >&2
		cleanup_status=1
	fi
elif launchctl getenv OPENROUTER_API_KEY >/tmp/nixmac-e2e-openrouter-env.out 2>/dev/null; then
	if [[ -s /tmp/nixmac-e2e-openrouter-env.out ]]; then
		echo "error: OPENROUTER_API_KEY still exists in launchd environment after cleanup" >&2
		cleanup_status=1
	fi
fi
rm -f /tmp/nixmac-e2e-openrouter-env.out

if [[ "$STATE" == "existed" && -d "$REMOTE_BACKUP" ]]; then
	if ! rm -rf "$SUPPORT" || ! mkdir -p "$(dirname "$SUPPORT")" || ! cp -pR "$REMOTE_BACKUP" "$SUPPORT"; then
		echo "error: failed to restore nixmac app-support backup" >&2
		cleanup_status=1
	fi
elif [[ "$STATE" == "absent" ]]; then
	if ! rm -rf "$SUPPORT"; then
		echo "error: failed to remove disposable nixmac app-support directory" >&2
		cleanup_status=1
	fi
fi

rm -rf "$REMOTE_BACKUP" "${REMOTE_BACKUP}.state" || cleanup_status=1
rm -rf "$REMOTE_CONFIG" || cleanup_status=1
rm -f "$REMOTE_AUTH_BACKUP" || cleanup_status=1
pkill -f 'codex app-server --listen ws://127.0.0.1:18790' >/dev/null 2>&1 || true

exit "$cleanup_status"
