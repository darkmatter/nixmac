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
#
# Optional system-restore env vars:
#   REMOTE_SYSTEM_MARKER - Absolute path to the validated v1 restore marker
#   REMOTE_RESTORE_RESULT - Absolute path for terminal JSON evidence
#
# Test-only:
#   NIXMAC_E2E_REMOTE_RESTORE_PLAN_ONLY=true validates the marker and emits a
#   plan without running sudo, Homebrew, process, filesystem, or launchctl actions.

cleanup_status=0
restore_errors=()
marker_loaded=false
legacy_paths_valid=true
system_preconditions_valid=false
formula_preconditions_valid=false
system_restore_required=false
system_restore_attempted=false
system_restored=false
profile_set_succeeded=false
activation_succeeded=false
formula_cleanup_planned=false
formula_cleanup_attempted=false
formula_restored=false
active_system_before=""
active_system_after=""
profile_store_before=""
profile_store_after=""
formula_installed_after=""
formula_version_after=""
formula_executable_after=""
formula_executable_version_after=""
formula_cellar_path=""
formula_opt_path=""
gui_uid=""

record_error() {
	local message="$1"
	echo "error: $message" >&2
	restore_errors+=("$message")
	cleanup_status=1
}

auth_requires_user() {
	local plist_path="$1"
	/usr/bin/plutil -extract authenticate-user raw -o - "$plist_path" 2>/dev/null || true
}

is_absolute_non_root_path() {
	[[ "$1" == /* && "$1" != "/" && "$1" != *".."* && "$1" != *$'\n'* && "$1" != *$'\r'* ]]
}

validate_remote_home() {
	if ! is_absolute_non_root_path "${HOME:-}" || [[ "$HOME" == //* || "$HOME" == *//* || "$HOME" == */. ]]; then
		echo "error: HOME must be a normalized non-root absolute path" >&2
		return 1
	fi
}

is_scoped_cleanup_path() {
	local name="$1" value="$2"
	case "$name" in
	REMOTE_BACKUP) [[ "$value" =~ ^/tmp/nixmac-computer-use-e2e-backup-[A-Za-z0-9][A-Za-z0-9._-]*$ ]] ;;
	REMOTE_CONFIG) [[ "$value" =~ ^/tmp/nixmac-computer-use-e2e-config-[A-Za-z0-9][A-Za-z0-9._-]*$ ]] ;;
	REMOTE_KEY_FILE) [[ "$value" =~ ^/tmp/nixmac-openrouter-key-[A-Za-z0-9][A-Za-z0-9._-]*$ ]] ;;
	REMOTE_AUTH_BACKUP) [[ "$value" =~ ^/tmp/nixmac-computer-use-e2e-auth-system-privilege-admin-[A-Za-z0-9][A-Za-z0-9._-]*\.plist$ ]] ;;
	REMOTE_APP_STAGE) [[ "$value" =~ ^/tmp/nixmac-computer-use-e2e-app-[A-Za-z0-9][A-Za-z0-9._-]*$ ]] ;;
	*) return 1 ;;
	esac
}

validate_legacy_paths() {
	local name value
	for name in REMOTE_BACKUP REMOTE_CONFIG REMOTE_KEY_FILE REMOTE_AUTH_BACKUP REMOTE_APP_STAGE; do
		value="${!name:-}"
		if ! is_absolute_non_root_path "$value" || ! is_scoped_cleanup_path "$name" "$value"; then
			legacy_paths_valid=false
			record_error "$name must be its run-scoped /tmp path"
		fi
	done
}

bind_marker_pointer() {
	local name="$1" marker_value="$2" current_value="${!1:-}"
	if [[ -n "$current_value" && "$current_value" != "$marker_value" ]]; then
		record_error "$name disagrees with the durable restore marker"
		return 1
	fi
	printf -v "$name" '%s' "$marker_value"
}

load_restore_marker() {
	if [[ -z "${REMOTE_SYSTEM_MARKER:-}" ]]; then
		return 0
	fi
	local fixed_marker="$HOME/.nixmac-e2e/system-restore-marker.json"
	local fixed_result="$HOME/.nixmac-e2e/system-restore-result.json"
	if [[ "$REMOTE_SYSTEM_MARKER" != "$fixed_marker" ]]; then
		record_error "REMOTE_SYSTEM_MARKER must use the fixed durable remote-home path"
		return 1
	fi
	if [[ -n "${REMOTE_RESTORE_RESULT:-}" && "$REMOTE_RESTORE_RESULT" != "$fixed_result" ]]; then
		record_error "REMOTE_RESTORE_RESULT must use the fixed durable remote-home path"
		return 1
	fi
	REMOTE_RESTORE_RESULT="$fixed_result"
	if ! is_absolute_non_root_path "$REMOTE_SYSTEM_MARKER"; then
		record_error "REMOTE_SYSTEM_MARKER must be a non-root absolute path"
		return 1
	fi
	if [[ ! -f "$REMOTE_SYSTEM_MARKER" ]]; then
		record_error "remote system restore marker is missing"
		return 1
	fi
	if [[ -L "$REMOTE_SYSTEM_MARKER" ]]; then
		record_error "remote system restore marker must not be a symlink"
		return 1
	fi

	local assignments
	assignments="$(/usr/bin/python3 - "$REMOTE_SYSTEM_MARKER" <<'PY'
import datetime
import json
import re
import shlex
import sys
from pathlib import Path

path = Path(sys.argv[1])
try:
    marker = json.loads(path.read_text(encoding="utf-8"))
except (OSError, json.JSONDecodeError) as error:
    raise SystemExit(f"invalid restore marker JSON: {error}")

expected_top = {
    "version",
    "runId",
    "capturedAt",
    "originalSystem",
    "profilePath",
    "nixEnvPath",
    "formula",
    "cleanup",
}
if not isinstance(marker, dict) or set(marker) != expected_top:
    raise SystemExit("restore marker has unexpected top-level fields")
if marker.get("version") != 1:
    raise SystemExit("restore marker version must be 1")
run_id = marker.get("runId")
if not isinstance(run_id, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", run_id):
    raise SystemExit("restore marker runId is invalid")
captured_at = marker.get("capturedAt")
if not isinstance(captured_at, str) or not re.fullmatch(
    r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z", captured_at
):
    raise SystemExit("restore marker capturedAt is invalid")
try:
    parsed_at = datetime.datetime.fromisoformat(captured_at.replace("Z", "+00:00"))
except ValueError as error:
    raise SystemExit("restore marker capturedAt is invalid") from error
if parsed_at.tzinfo != datetime.timezone.utc:
    raise SystemExit("restore marker capturedAt must be UTC")
original_system = marker.get("originalSystem")
if not isinstance(original_system, str) or not re.fullmatch(
    r"/nix/store/[a-z0-9]{32}-darwin-system-[A-Za-z0-9._+-]+", original_system
):
    raise SystemExit("restore marker originalSystem is invalid")
if marker.get("profilePath") != "/nix/var/nix/profiles/system":
    raise SystemExit("restore marker profilePath is invalid")
if marker.get("nixEnvPath") != "/nix/var/nix/profiles/default/bin/nix-env":
    raise SystemExit("restore marker nixEnvPath is invalid")

formula = marker.get("formula")
expected_formula = {
    "name",
    "brewPath",
    "executablePath",
    "installedBefore",
    "versionBefore",
    "executableVersionBefore",
}
if not isinstance(formula, dict) or set(formula) != expected_formula:
    raise SystemExit("restore marker formula has unexpected fields")
if formula.get("name") != "hello":
    raise SystemExit("restore marker formula must be hello")
brew_path = formula.get("brewPath")
if brew_path not in {"/opt/homebrew/bin/brew", "/usr/local/bin/brew"}:
    raise SystemExit("restore marker Homebrew path is invalid")
expected_executable = str(Path(brew_path).with_name("hello"))
if formula.get("executablePath") != expected_executable:
    raise SystemExit("restore marker hello executable path is invalid")
installed_before = formula.get("installedBefore")
if not isinstance(installed_before, bool):
    raise SystemExit("restore marker installedBefore must be boolean")
version_before = formula.get("versionBefore")
executable_version_before = formula.get("executableVersionBefore")
for name, value in (
    ("versionBefore", version_before),
    ("executableVersionBefore", executable_version_before),
):
    if value is not None and (not isinstance(value, str) or not value.strip()):
        raise SystemExit(f"restore marker {name} must be null or a non-empty string")
if installed_before or version_before is not None or executable_version_before is not None:
    raise SystemExit("restore marker requires hello to be absent before the run")

cleanup = marker.get("cleanup")
expected_cleanup = {
    "appSupportBackup": f"/tmp/nixmac-computer-use-e2e-backup-{run_id}",
    "appSupportState": f"/tmp/nixmac-computer-use-e2e-backup-{run_id}.state",
    "configDir": f"/tmp/nixmac-computer-use-e2e-config-{run_id}",
    "appStage": f"/tmp/nixmac-computer-use-e2e-app-{run_id}",
    "keyFile": f"/tmp/nixmac-openrouter-key-{run_id}",
    "authBackup": f"/tmp/nixmac-computer-use-e2e-auth-system-privilege-admin-{run_id}.plist",
}
if not isinstance(cleanup, dict) or set(cleanup) != set(expected_cleanup):
    raise SystemExit("restore marker cleanup pointers have unexpected fields")
for name, expected in expected_cleanup.items():
    if cleanup.get(name) != expected:
        raise SystemExit(f"restore marker cleanup pointer {name} is invalid")

values = {
    "MARKER_RUN_ID": run_id,
    "ORIGINAL_SYSTEM": original_system,
    "PROFILE_PATH": marker["profilePath"],
    "NIX_ENV_PATH": marker["nixEnvPath"],
    "BREW_PATH": brew_path,
    "FORMULA_EXECUTABLE_PATH": expected_executable,
    "FORMULA_INSTALLED_BEFORE": "true" if installed_before else "false",
    "FORMULA_VERSION_BEFORE": version_before or "",
    "FORMULA_EXECUTABLE_VERSION_BEFORE": executable_version_before or "",
    "MARKER_REMOTE_BACKUP": cleanup["appSupportBackup"],
    "MARKER_REMOTE_BACKUP_STATE": cleanup["appSupportState"],
    "MARKER_REMOTE_CONFIG": cleanup["configDir"],
    "MARKER_REMOTE_APP_STAGE": cleanup["appStage"],
    "MARKER_REMOTE_KEY_FILE": cleanup["keyFile"],
    "MARKER_REMOTE_AUTH_BACKUP": cleanup["authBackup"],
}
for name, value in values.items():
    print(f"{name}={shlex.quote(value)}")
PY
)"
	if [[ "$?" -ne 0 || -z "$assignments" ]]; then
		record_error "remote system restore marker failed validation"
		return 1
	fi
	eval "$assignments"
	if ! bind_marker_pointer REMOTE_BACKUP "$MARKER_REMOTE_BACKUP"; then
		return 1
	fi
	if [[ "$MARKER_REMOTE_BACKUP_STATE" != "${MARKER_REMOTE_BACKUP}.state" ]]; then
		record_error "REMOTE_BACKUP state pointer is invalid"
		return 1
	fi
	if ! bind_marker_pointer REMOTE_CONFIG "$MARKER_REMOTE_CONFIG" ||
		! bind_marker_pointer REMOTE_KEY_FILE "$MARKER_REMOTE_KEY_FILE" ||
		! bind_marker_pointer REMOTE_AUTH_BACKUP "$MARKER_REMOTE_AUTH_BACKUP" ||
		! bind_marker_pointer REMOTE_APP_STAGE "$MARKER_REMOTE_APP_STAGE"; then
		return 1
	fi
	marker_loaded=true
	formula_cellar_path="${BREW_PATH%/bin/brew}/Cellar/hello"
	formula_opt_path="${BREW_PATH%/bin/brew}/opt/hello"
	formula_cleanup_planned=true
	return 0
}

validate_restore_preconditions() {
	[[ "$marker_loaded" == "true" ]] || return 0
	system_preconditions_valid=true
	formula_preconditions_valid=true
	gui_uid="$(/usr/bin/stat -f %u /dev/console 2>/dev/null || true)"
	if [[ ! "$gui_uid" =~ ^[0-9]+$ ]]; then
		system_preconditions_valid=false
		record_error "console user UID is unavailable for nix-darwin activation"
	fi
	if [[ ! -d "$ORIGINAL_SYSTEM" ]]; then
		system_preconditions_valid=false
		record_error "recorded original system store path is unavailable"
	fi
	if [[ ! -x "$ORIGINAL_SYSTEM/activate" ]]; then
		system_preconditions_valid=false
		record_error "recorded original system activate script is unavailable"
	fi
	if [[ ! -x "$ORIGINAL_SYSTEM/activate-user" ]]; then
		system_preconditions_valid=false
		record_error "recorded original system user activation script is unavailable"
	fi
	if [[ ! -x "$ORIGINAL_SYSTEM/sw/bin/darwin-rebuild" ]]; then
		system_preconditions_valid=false
		record_error "recorded original system darwin-rebuild is unavailable"
	fi
	if [[ ! -r "$ORIGINAL_SYSTEM/systemConfig" || "$(/bin/cat "$ORIGINAL_SYSTEM/systemConfig" 2>/dev/null)" != "$ORIGINAL_SYSTEM" ]]; then
		system_preconditions_valid=false
		record_error "recorded original systemConfig does not match the restore target"
	fi
	if [[ ! -x "$NIX_ENV_PATH" ]]; then
		system_preconditions_valid=false
		record_error "recorded nix-env executable is unavailable"
	fi
	if [[ ! -x "$BREW_PATH" ]]; then
		formula_preconditions_valid=false
		record_error "recorded Homebrew executable is unavailable"
	fi
	if [[ "$system_preconditions_valid" == "true" ]]; then
		if ! /usr/bin/sudo -n -l -- "$NIX_ENV_PATH" --profile "$PROFILE_PATH" --set "$ORIGINAL_SYSTEM" >/dev/null 2>&1; then
			system_preconditions_valid=false
			record_error "passwordless sudo does not allow the exact nix-env profile restore command"
		fi
		if ! /usr/bin/sudo -n -l -- /bin/launchctl asuser "$gui_uid" "$ORIGINAL_SYSTEM/sw/bin/darwin-rebuild" activate >/dev/null 2>&1; then
			system_preconditions_valid=false
			record_error "passwordless sudo does not allow the exact Aqua-domain activation command"
		fi
		if ! /usr/bin/sudo -n -H /bin/launchctl asuser "$gui_uid" /usr/bin/true >/dev/null 2>&1; then
			system_preconditions_valid=false
			record_error "console user's Aqua bootstrap domain is unavailable"
		fi
	fi
}

read_active_system() {
	/usr/bin/readlink -f /run/current-system 2>/dev/null || true
}

read_profile_store() {
	/usr/bin/readlink -f "$PROFILE_PATH" 2>/dev/null || true
}

run_profile_set() {
	/usr/bin/sudo -n -H "$NIX_ENV_PATH" --profile "$PROFILE_PATH" --set "$ORIGINAL_SYSTEM" \
		>"/tmp/nixmac-e2e-original-system-profile-${MARKER_RUN_ID}.out" \
		2>"/tmp/nixmac-e2e-original-system-profile-${MARKER_RUN_ID}.err"
}

run_system_activate() {
	/usr/bin/sudo -n -H /bin/launchctl asuser "$gui_uid" \
		"$ORIGINAL_SYSTEM/sw/bin/darwin-rebuild" activate \
		>"/tmp/nixmac-e2e-original-system-activate-${MARKER_RUN_ID}.out" \
		2>"/tmp/nixmac-e2e-original-system-activate-${MARKER_RUN_ID}.err"
}

capture_live_system_state() {
	active_system_after="$(read_active_system)"
	profile_store_after="$(read_profile_store)"
}

restore_original_system() {
	[[ "$marker_loaded" == "true" ]] || return 0
	system_restore_required=true
	active_system_before="$(read_active_system)"
	profile_store_before="$(read_profile_store)"
	if [[ "$system_preconditions_valid" != "true" ]]; then
		return 1
	fi

	# Always reactivate the recorded closure. Matching symlinks do not prove that
	# a prior activation completed all of its side effects.
	system_restore_attempted=true
	if run_profile_set; then
		profile_set_succeeded=true
	else
		record_error "failed to reset the nix-darwin system profile to the recorded original system"
	fi
	if run_system_activate; then
		activation_succeeded=true
	else
		record_error "failed to activate the recorded original nix-darwin system"
	fi

	capture_live_system_state
	if [[ "$profile_set_succeeded" != "true" || "$activation_succeeded" != "true" ||
		"$active_system_after" != "$ORIGINAL_SYSTEM" || "$profile_store_after" != "$ORIGINAL_SYSTEM" ]]; then
		record_error "original nix-darwin system verification failed after restore"
		return 1
	fi
	system_restored=true
	return 0
}

formula_artifact_present() {
	[[ -e "$formula_cellar_path" || -L "$formula_cellar_path" ||
		-e "$formula_opt_path" || -L "$formula_opt_path" ||
		-e "$FORMULA_EXECUTABLE_PATH" || -L "$FORMULA_EXECUTABLE_PATH" ]]
}

formula_cellar_versions() {
	[[ -d "$formula_cellar_path" ]] || return 0
	/usr/bin/find "$formula_cellar_path" -mindepth 1 -maxdepth 1 -type d -exec /usr/bin/basename {} \; 2>/dev/null |
		/usr/bin/sort | /usr/bin/tr '\n' ' ' | /usr/bin/sed 's/[[:space:]]*$//'
}

capture_formula_state() {
	if formula_artifact_present; then
		formula_installed_after=true
		local versions
		versions="$(formula_cellar_versions)"
		formula_version_after="${versions:+hello $versions}"
	else
		formula_installed_after=false
		formula_version_after=""
	fi
	if [[ -e "$FORMULA_EXECUTABLE_PATH" || -L "$FORMULA_EXECUTABLE_PATH" ]]; then
		formula_executable_after=true
		if [[ -x "$FORMULA_EXECUTABLE_PATH" ]]; then
			formula_executable_version_after="$("$FORMULA_EXECUTABLE_PATH" --version 2>&1 | /usr/bin/head -1)"
		else
			formula_executable_version_after="not executable"
		fi
	else
		formula_executable_after=false
		formula_executable_version_after=""
	fi
}

run_formula_uninstall() {
	"$BREW_PATH" uninstall --force hello \
		>"/tmp/nixmac-e2e-hello-uninstall-${MARKER_RUN_ID}.out" \
		2>"/tmp/nixmac-e2e-hello-uninstall-${MARKER_RUN_ID}.err"
}

restore_formula_state() {
	[[ "$marker_loaded" == "true" ]] || return 0
	if [[ "$formula_preconditions_valid" != "true" ]]; then
		return 1
	fi
	export HOMEBREW_NO_AUTO_UPDATE=1
	export HOMEBREW_NO_ANALYTICS=1
	if [[ "$FORMULA_INSTALLED_BEFORE" != "false" ]]; then
		record_error "refusing formula restore without a recorded absent hello baseline"
		return 1
	fi
	if formula_artifact_present; then
		formula_cleanup_attempted=true
		if ! run_formula_uninstall; then
			record_error "failed to uninstall hello after the Product Proof run"
		fi
	fi
	capture_formula_state
	if [[ "$formula_installed_after" != "false" || "$formula_executable_after" != "false" ]]; then
		record_error "hello remained installed even though it was absent before the run"
		return 1
	fi
	formula_restored=true
	return 0
}

write_terminal_result() {
	local status="$1"
	local marker_retained="$2"
	local plan_only="$3"
	local result_path="${REMOTE_RESTORE_RESULT:-}"
	local expected_result="/tmp/nixmac-e2e-remote-restore-result.json"
	if [[ -n "${REMOTE_SYSTEM_MARKER:-}" ]]; then
		expected_result="$HOME/.nixmac-e2e/system-restore-result.json"
	fi
	[[ -n "$result_path" ]] || result_path="$expected_result"
	if [[ "$result_path" != "$expected_result" || -L "$result_path" ]]; then
		echo "error: REMOTE_RESTORE_RESULT must be the fixed non-symlink evidence path" >&2
		return 1
	fi

	local errors_text=""
	if [[ "${#restore_errors[@]}" -gt 0 ]]; then
		errors_text="$(printf '%s\n' "${restore_errors[@]}")"
	fi
	RESTORE_RESULT_PATH="$result_path" \
		RESTORE_STATUS="$status" \
		RESTORE_MARKER_PATH="${REMOTE_SYSTEM_MARKER:-}" \
		RESTORE_MARKER_RETAINED="$marker_retained" \
		RESTORE_PLAN_ONLY="$plan_only" \
		RESTORE_MARKER_LOADED="$marker_loaded" \
		RESTORE_RUN_ID="${MARKER_RUN_ID:-}" \
		RESTORE_ORIGINAL_SYSTEM="${ORIGINAL_SYSTEM:-}" \
		RESTORE_PROFILE_PATH="${PROFILE_PATH:-}" \
		RESTORE_NIX_ENV_PATH="${NIX_ENV_PATH:-}" \
		RESTORE_ACTIVE_BEFORE="$active_system_before" \
		RESTORE_ACTIVE_AFTER="$active_system_after" \
		RESTORE_PROFILE_BEFORE="$profile_store_before" \
		RESTORE_PROFILE_AFTER="$profile_store_after" \
		RESTORE_GUI_UID="$gui_uid" \
		RESTORE_SYSTEM_PREFLIGHT="$system_preconditions_valid" \
		RESTORE_SYSTEM_REQUIRED="$system_restore_required" \
		RESTORE_SYSTEM_ATTEMPTED="$system_restore_attempted" \
		RESTORE_PROFILE_SET_SUCCEEDED="$profile_set_succeeded" \
		RESTORE_ACTIVATION_SUCCEEDED="$activation_succeeded" \
		RESTORE_SYSTEM_RESTORED="$system_restored" \
		RESTORE_FORMULA_NAME="${FORMULA_NAME:-hello}" \
		RESTORE_BREW_PATH="${BREW_PATH:-}" \
		RESTORE_FORMULA_EXECUTABLE="${FORMULA_EXECUTABLE_PATH:-}" \
		RESTORE_FORMULA_INSTALLED_BEFORE="${FORMULA_INSTALLED_BEFORE:-}" \
		RESTORE_FORMULA_VERSION_BEFORE="${FORMULA_VERSION_BEFORE:-}" \
		RESTORE_FORMULA_EXECUTABLE_VERSION_BEFORE="${FORMULA_EXECUTABLE_VERSION_BEFORE:-}" \
		RESTORE_FORMULA_CLEANUP_PLANNED="$formula_cleanup_planned" \
		RESTORE_FORMULA_PREFLIGHT="$formula_preconditions_valid" \
		RESTORE_FORMULA_CLEANUP_ATTEMPTED="$formula_cleanup_attempted" \
		RESTORE_FORMULA_RESTORED="$formula_restored" \
		RESTORE_FORMULA_INSTALLED_AFTER="$formula_installed_after" \
		RESTORE_FORMULA_VERSION_AFTER="$formula_version_after" \
		RESTORE_FORMULA_EXECUTABLE_AFTER="$formula_executable_after" \
		RESTORE_FORMULA_EXECUTABLE_VERSION_AFTER="$formula_executable_version_after" \
		RESTORE_APP_SUPPORT_BACKUP="${REMOTE_BACKUP:-}" \
		RESTORE_APP_SUPPORT_STATE="${REMOTE_BACKUP:+${REMOTE_BACKUP}.state}" \
		RESTORE_CONFIG_DIR="${REMOTE_CONFIG:-}" \
		RESTORE_APP_STAGE="${REMOTE_APP_STAGE:-}" \
		RESTORE_KEY_FILE="${REMOTE_KEY_FILE:-}" \
		RESTORE_AUTH_BACKUP="${REMOTE_AUTH_BACKUP:-}" \
		RESTORE_ERRORS_TEXT="$errors_text" \
		/usr/bin/python3 - <<'PY'
import json
import os
import tempfile
from pathlib import Path

def boolean(name):
    return os.environ.get(name) == "true"

def nullable(name):
    value = os.environ.get(name, "")
    return value or None

def optional_boolean(name):
    value = os.environ.get(name, "")
    if value == "true":
        return True
    if value == "false":
        return False
    return None

result_path = Path(os.environ["RESTORE_RESULT_PATH"])
result_path.parent.mkdir(parents=True, exist_ok=True)
result = {
    "version": 1,
    "status": os.environ["RESTORE_STATUS"],
    "planOnly": boolean("RESTORE_PLAN_ONLY"),
    "runId": nullable("RESTORE_RUN_ID"),
    "marker": {
        "path": nullable("RESTORE_MARKER_PATH"),
        "loaded": boolean("RESTORE_MARKER_LOADED"),
        "retained": boolean("RESTORE_MARKER_RETAINED"),
    },
    "system": {
        "original": nullable("RESTORE_ORIGINAL_SYSTEM"),
        "profilePath": nullable("RESTORE_PROFILE_PATH"),
        "nixEnvPath": nullable("RESTORE_NIX_ENV_PATH"),
        "activeBefore": nullable("RESTORE_ACTIVE_BEFORE"),
        "activeAfter": nullable("RESTORE_ACTIVE_AFTER"),
        "profileBefore": nullable("RESTORE_PROFILE_BEFORE"),
        "profileAfter": nullable("RESTORE_PROFILE_AFTER"),
        "consoleUid": nullable("RESTORE_GUI_UID"),
        "preconditionsPassed": boolean("RESTORE_SYSTEM_PREFLIGHT"),
        "restoreRequired": boolean("RESTORE_SYSTEM_REQUIRED"),
        "restoreAttempted": boolean("RESTORE_SYSTEM_ATTEMPTED"),
        "profileSetSucceeded": boolean("RESTORE_PROFILE_SET_SUCCEEDED"),
        "activationSucceeded": boolean("RESTORE_ACTIVATION_SUCCEEDED"),
        "restored": boolean("RESTORE_SYSTEM_RESTORED"),
        "profileSetCommand": [
            "/usr/bin/sudo",
            "-n",
            "-H",
            nullable("RESTORE_NIX_ENV_PATH"),
            "--profile",
            nullable("RESTORE_PROFILE_PATH"),
            "--set",
            nullable("RESTORE_ORIGINAL_SYSTEM"),
        ],
        "activateCommand": [
            "/usr/bin/sudo",
            "-n",
            "-H",
            "/bin/launchctl",
            "asuser",
            nullable("RESTORE_GUI_UID"),
            None if not os.environ.get("RESTORE_ORIGINAL_SYSTEM") else os.path.join(os.environ["RESTORE_ORIGINAL_SYSTEM"], "sw/bin/darwin-rebuild"),
            "activate",
        ],
    },
    "formula": {
        "name": os.environ.get("RESTORE_FORMULA_NAME", "hello"),
        "brewPath": nullable("RESTORE_BREW_PATH"),
        "executablePath": nullable("RESTORE_FORMULA_EXECUTABLE"),
        "installedBefore": optional_boolean("RESTORE_FORMULA_INSTALLED_BEFORE"),
        "versionBefore": nullable("RESTORE_FORMULA_VERSION_BEFORE"),
        "executableVersionBefore": nullable("RESTORE_FORMULA_EXECUTABLE_VERSION_BEFORE"),
        "preconditionsPassed": boolean("RESTORE_FORMULA_PREFLIGHT"),
        "cleanupPlanned": boolean("RESTORE_FORMULA_CLEANUP_PLANNED"),
        "cleanupAttempted": boolean("RESTORE_FORMULA_CLEANUP_ATTEMPTED"),
        "restored": boolean("RESTORE_FORMULA_RESTORED"),
        "installedAfter": optional_boolean("RESTORE_FORMULA_INSTALLED_AFTER"),
        "versionAfter": nullable("RESTORE_FORMULA_VERSION_AFTER"),
        "executableAfter": optional_boolean("RESTORE_FORMULA_EXECUTABLE_AFTER"),
        "executableVersionAfter": nullable("RESTORE_FORMULA_EXECUTABLE_VERSION_AFTER"),
        "uninstallCommand": None if not boolean("RESTORE_FORMULA_CLEANUP_PLANNED") else [nullable("RESTORE_BREW_PATH"), "uninstall", "--force", "hello"],
    },
    "cleanup": {
        "appSupportBackup": nullable("RESTORE_APP_SUPPORT_BACKUP"),
        "appSupportState": nullable("RESTORE_APP_SUPPORT_STATE"),
        "configDir": nullable("RESTORE_CONFIG_DIR"),
        "appStage": nullable("RESTORE_APP_STAGE"),
        "keyFile": nullable("RESTORE_KEY_FILE"),
        "authBackup": nullable("RESTORE_AUTH_BACKUP"),
    },
    "errors": [line for line in os.environ.get("RESTORE_ERRORS_TEXT", "").splitlines() if line],
}
with tempfile.NamedTemporaryFile(
    mode="w",
    encoding="utf-8",
    dir=result_path.parent,
    prefix=f".{result_path.name}.",
    delete=False,
) as handle:
    temporary_path = Path(handle.name)
    json.dump(result, handle, indent=2, sort_keys=True)
    handle.write("\n")
    handle.flush()
    os.fsync(handle.fileno())
os.replace(temporary_path, result_path)
print(json.dumps(result, sort_keys=True))
PY
}

validate_recovery_artifacts() {
	STATE=""
	app_support_restore_ready=false
	auth_restore_ready=false
	if [[ -f "${REMOTE_BACKUP}.state" ]]; then
		STATE="$(/bin/cat "${REMOTE_BACKUP}.state" 2>/dev/null || true)"
	fi
	if [[ "$STATE" == "existed" && -d "$REMOTE_BACKUP" ]]; then
		app_support_restore_ready=true
	elif [[ "$STATE" == "absent" && ! -e "$REMOTE_BACKUP" && ! -L "$REMOTE_BACKUP" ]]; then
		app_support_restore_ready=true
	else
		record_error "nixmac app-support recovery artifacts are missing or invalid"
	fi
	if [[ -f "$REMOTE_AUTH_BACKUP" && ! -L "$REMOTE_AUTH_BACKUP" && "$(auth_requires_user "$REMOTE_AUTH_BACKUP")" == "true" ]]; then
		auth_restore_ready=true
	else
		record_error "system.privilege.admin recovery backup is missing or invalid"
	fi
}

marker_is_retained() {
	[[ -n "${REMOTE_SYSTEM_MARKER:-}" && -f "$REMOTE_SYSTEM_MARKER" && ! -L "$REMOTE_SYSTEM_MARKER" ]]
}

write_failure_evidence() {
	local plan_only="${1:-false}"
	local retained=false
	marker_is_retained && retained=true
	if [[ -n "${REMOTE_SYSTEM_MARKER:-}" ]]; then
		REMOTE_RESTORE_RESULT="$HOME/.nixmac-e2e/system-restore-result.json"
	else
		REMOTE_RESTORE_RESULT="/tmp/nixmac-e2e-remote-restore-result.json"
	fi
	write_terminal_result "fail" "$retained" "$plan_only" || true
}

deescalate_after_invalid_marker() {
	pkill -f 'nixmac-activate-temp|with administrator privileges|/nix/store/.*/activate|ln -s /etc/static/pam.d/sudo_local /etc/pam.d/sudo_local' >/dev/null 2>&1 || true
	/usr/bin/osascript -e 'tell application id "com.darkmatter.nixmac" to quit' >/dev/null 2>&1 || true
	pkill -x nixmac >/dev/null 2>&1 || true
	local emergency_uid
	emergency_uid="$(/usr/bin/stat -f %u /dev/console 2>/dev/null || /usr/bin/id -u)"
	if ! /usr/bin/sudo -n /bin/launchctl asuser "$emergency_uid" /bin/launchctl unsetenv OPENROUTER_API_KEY >/dev/null 2>&1; then
		/bin/launchctl unsetenv OPENROUTER_API_KEY >/dev/null 2>&1 || true
	fi
	if is_scoped_cleanup_path REMOTE_KEY_FILE "${REMOTE_KEY_FILE:-}"; then
		rm -f "$REMOTE_KEY_FILE" || record_error "failed to remove temporary OpenRouter key file during emergency de-escalation"
	fi
	if is_scoped_cleanup_path REMOTE_AUTH_BACKUP "${REMOTE_AUTH_BACKUP:-}" &&
		[[ -f "$REMOTE_AUTH_BACKUP" && ! -L "$REMOTE_AUTH_BACKUP" ]] &&
		[[ "$(auth_requires_user "$REMOTE_AUTH_BACKUP")" == "true" ]]; then
		if ! /usr/bin/sudo -n /usr/bin/security authorizationdb write system.privilege.admin <"$REMOTE_AUTH_BACKUP" >/tmp/nixmac-e2e-auth-emergency.out 2>/tmp/nixmac-e2e-auth-emergency.err; then
			record_error "failed to restore authorization policy during emergency de-escalation"
		fi
	fi
}

remove_restore_marker() {
	rm -f "$REMOTE_SYSTEM_MARKER"
}

finalize_success_marker_evidence() {
	# Persist a truthful pre-removal checkpoint first. The finalizer rejects
	# retained=true, so interruption can cause only a false red, never green.
	if ! write_terminal_result "pass" "true" "false"; then
		record_error "failed to write pre-removal remote restore evidence"
		return 1
	fi
	if ! remove_restore_marker; then
		record_error "failed to remove successful remote system restore marker"
		return 1
	fi
	if ! write_terminal_result "pass" "false" "false"; then
		record_error "failed to write remote restore terminal evidence"
		return 1
	fi
	return 0
}

main() {
	validate_remote_home || return 1
	load_restore_marker

	if [[ "${NIXMAC_E2E_REMOTE_RESTORE_PLAN_ONLY:-false}" == "true" ]]; then
		if [[ "$marker_loaded" == "true" && "$cleanup_status" -eq 0 ]]; then
			write_terminal_result "planned" "true" "true"
			return "$?"
		fi
		write_failure_evidence "true"
		return 1
	fi

	validate_legacy_paths

	# Invalid marker contents authorize no system/profile, formula, app-support,
	# or recovery-file mutation. Credential and authorization de-escalation use
	# independently scoped run paths and still run before the marker is retained.
	if [[ -n "${REMOTE_SYSTEM_MARKER:-}" && "$marker_loaded" != "true" ]]; then
		deescalate_after_invalid_marker
		write_failure_evidence
		return 1
	fi

	if [[ "$legacy_paths_valid" != "true" ]]; then
		write_failure_evidence
		return 1
	fi

	if [[ "$marker_loaded" == "true" ]]; then
		validate_restore_preconditions
	fi
	validate_recovery_artifacts

	pkill -f 'nixmac-activate-temp|with administrator privileges|/nix/store/.*/activate|ln -s /etc/static/pam.d/sudo_local /etc/pam.d/sudo_local' >/dev/null 2>&1 || true
	/usr/bin/osascript -e 'tell application id "com.darkmatter.nixmac" to quit' >/dev/null 2>&1 || true
	pkill -x nixmac >/dev/null 2>&1 || true

	if is_scoped_cleanup_path REMOTE_KEY_FILE "$REMOTE_KEY_FILE"; then
		rm -f "$REMOTE_KEY_FILE" || record_error "failed to remove temporary OpenRouter key file"
	fi
	if is_scoped_cleanup_path REMOTE_APP_STAGE "$REMOTE_APP_STAGE"; then
		rm -rf "$REMOTE_APP_STAGE" || record_error "failed to remove staged nixmac app bundle"
	fi

	SUPPORT="$HOME/Library/Application Support/com.darkmatter.nixmac"
	GUI_UID="${gui_uid:-$(/usr/bin/stat -f %u /dev/console 2>/dev/null || /usr/bin/id -u)}"
	if ! /usr/bin/sudo -n /bin/launchctl asuser "$GUI_UID" /bin/launchctl unsetenv OPENROUTER_API_KEY >/dev/null 2>&1; then
		/bin/launchctl unsetenv OPENROUTER_API_KEY >/dev/null 2>&1 || true
	fi

	# These two repairs are independent: a missing old system closure must not
	# prevent removing hello, and a Homebrew problem must not block system repair.
	restore_original_system
	restore_formula_state

	if [[ "$auth_restore_ready" == "true" ]]; then
		if ! /usr/bin/sudo -n /usr/bin/security authorizationdb write system.privilege.admin <"$REMOTE_AUTH_BACKUP" >/tmp/nixmac-e2e-auth-restore.out 2>/tmp/nixmac-e2e-auth-restore.err; then
			record_error "failed to restore system.privilege.admin authorization policy"
		fi
	fi

	current_auth="$(/usr/bin/mktemp /tmp/nixmac-e2e-auth-current.XXXXXX)"
	if /usr/bin/sudo -n /usr/bin/security authorizationdb read system.privilege.admin >"$current_auth" 2>/tmp/nixmac-e2e-auth-current.err; then
		if [[ "$(auth_requires_user "$current_auth")" != "true" ]]; then
			record_error "system.privilege.admin did not return to authenticated baseline"
		fi
	else
		record_error "could not read system.privilege.admin after cleanup"
	fi
	rm -f "$current_auth"

	if /usr/bin/sudo -n /bin/launchctl asuser "$GUI_UID" /bin/launchctl getenv OPENROUTER_API_KEY >/tmp/nixmac-e2e-openrouter-env.out 2>/dev/null; then
		if [[ -s /tmp/nixmac-e2e-openrouter-env.out ]]; then
			record_error "OPENROUTER_API_KEY still exists in GUI launchd environment after cleanup"
		fi
	elif /bin/launchctl getenv OPENROUTER_API_KEY >/tmp/nixmac-e2e-openrouter-env.out 2>/dev/null; then
		if [[ -s /tmp/nixmac-e2e-openrouter-env.out ]]; then
			record_error "OPENROUTER_API_KEY still exists in launchd environment after cleanup"
		fi
	fi
	rm -f /tmp/nixmac-e2e-openrouter-env.out

	if [[ "$app_support_restore_ready" == "true" && "$STATE" == "existed" ]]; then
		if ! rm -rf "$SUPPORT" || ! mkdir -p "$(/usr/bin/dirname "$SUPPORT")" || ! cp -pR "$REMOTE_BACKUP" "$SUPPORT"; then
			record_error "failed to restore nixmac app-support backup"
		fi
	elif [[ "$app_support_restore_ready" == "true" && "$STATE" == "absent" ]]; then
		if ! rm -rf "$SUPPORT"; then
			record_error "failed to remove disposable nixmac app-support directory"
		fi
	fi

	pkill -f '[c]odex app-server .*--listen ws://127.0.0.1:18790' >/dev/null 2>&1 || true

	# Recovery inputs survive every failed teardown. Delete them only after every
	# restore and verification step has succeeded.
	if [[ "$cleanup_status" -eq 0 ]]; then
		if is_scoped_cleanup_path REMOTE_CONFIG "$REMOTE_CONFIG"; then
			rm -rf "$REMOTE_CONFIG" || record_error "failed to remove disposable nix config"
		fi
		if is_scoped_cleanup_path REMOTE_BACKUP "$REMOTE_BACKUP"; then
			rm -rf "$REMOTE_BACKUP" "${REMOTE_BACKUP}.state" || record_error "failed to remove app-support recovery backup"
		fi
		if is_scoped_cleanup_path REMOTE_AUTH_BACKUP "$REMOTE_AUTH_BACKUP"; then
			rm -f "$REMOTE_AUTH_BACKUP" || record_error "failed to remove authorization recovery backup"
		fi
	fi

	if [[ "$cleanup_status" -eq 0 ]]; then
		if [[ "$marker_loaded" == "true" ]]; then
			finalize_success_marker_evidence
		else
			REMOTE_RESTORE_RESULT="/tmp/nixmac-e2e-remote-restore-result.json"
			write_terminal_result "pass-legacy" "false" "false" || record_error "failed to write remote restore terminal evidence"
		fi
	fi

	if [[ "$cleanup_status" -ne 0 ]]; then
		write_failure_evidence
	fi
	return "$cleanup_status"
}

if [[ "${NIXMAC_E2E_REMOTE_RESTORE_LIBRARY_ONLY:-false}" != "true" ]]; then
	main "$@"
	exit "$?"
fi
