#!/usr/bin/env bash
# The sourced restore library and test-double functions are deliberately opaque
# when this file is linted alone by prek.
# shellcheck disable=SC1091,SC2030,SC2031,SC2034,SC2154,SC2329
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
restore_script="$script_dir/remote-restore.sh"
test_root="$(mktemp -d /tmp/nixmac-remote-restore-self-test.XXXXXX)"
trap 'rm -rf "$test_root"' EXIT

original_system="/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-darwin-system-26.11.test"
test_home="$test_root/home"
marker_path="$test_home/.nixmac-e2e/system-restore-marker.json"
result_path="$test_home/.nixmac-e2e/system-restore-result.json"
mkdir -p "$(dirname "$marker_path")"

write_marker() {
	local path="$1"
	local formula="$2"
	local installed="$3"
	local version executable_version
	if [[ "$installed" == "true" ]]; then
		version='"hello 2.12.3"'
		executable_version='"hello (GNU Hello) 2.12.3"'
	else
		version=null
		executable_version=null
	fi
	cat >"$path" <<JSON
{
  "version": 1,
  "runId": "self-test-1",
  "capturedAt": "2026-08-25T00:45:31.000Z",
  "originalSystem": "$original_system",
  "profilePath": "/nix/var/nix/profiles/system",
  "nixEnvPath": "/nix/var/nix/profiles/default/bin/nix-env",
  "formula": {
    "name": "$formula",
    "brewPath": "/opt/homebrew/bin/brew",
    "executablePath": "/opt/homebrew/bin/$formula",
    "installedBefore": $installed,
    "versionBefore": $version,
    "executableVersionBefore": $executable_version
  },
  "cleanup": {
    "appSupportBackup": "/tmp/nixmac-computer-use-e2e-backup-self-test-1",
    "appSupportState": "/tmp/nixmac-computer-use-e2e-backup-self-test-1.state",
    "configDir": "/tmp/nixmac-computer-use-e2e-config-self-test-1",
    "appStage": "/tmp/nixmac-computer-use-e2e-app-self-test-1",
    "keyFile": "/tmp/nixmac-openrouter-key-self-test-1",
    "authBackup": "/tmp/nixmac-computer-use-e2e-auth-system-privilege-admin-self-test-1.plist"
  }
}
JSON
}

write_marker "$marker_path" hello false
HOME="$test_home" \
	REMOTE_SYSTEM_MARKER="$marker_path" \
	NIXMAC_E2E_REMOTE_RESTORE_PLAN_ONLY=true \
	bash "$restore_script" >/dev/null
jq -e '
  .status == "planned" and
  .planOnly == true and
  .marker.loaded == true and
  .marker.retained == true and
  .system.original == $system and
  .formula.name == "hello" and
  .formula.installedBefore == false and
  .formula.cleanupPlanned == true and
  .formula.uninstallCommand == ["/opt/homebrew/bin/brew", "uninstall", "--force", "hello"]
' --arg system "$original_system" "$result_path" >/dev/null
[[ -f "$marker_path" ]]

write_marker "$marker_path" hello false
decoy_result="$test_root/decoy.json"
printf '%s\n' untouched >"$decoy_result"
if HOME="$test_home" \
	REMOTE_SYSTEM_MARKER="$marker_path" \
	REMOTE_RESTORE_RESULT="$decoy_result" \
	NIXMAC_E2E_REMOTE_RESTORE_PLAN_ONLY=true \
	bash "$restore_script" >/dev/null 2>&1; then
	echo "mismatched result path unexpectedly passed" >&2
	exit 1
fi
[[ "$(cat "$decoy_result")" == "untouched" ]]
jq -e '.status == "fail" and .marker.retained == true' "$result_path" >/dev/null

write_marker "$marker_path" hello true
if HOME="$test_home" \
	REMOTE_SYSTEM_MARKER="$marker_path" \
	NIXMAC_E2E_REMOTE_RESTORE_PLAN_ONLY=true \
	bash "$restore_script" >/dev/null 2>&1; then
	echo "installed hello baseline unexpectedly passed" >&2
	exit 1
fi
jq -e '
  .status == "fail" and
  .marker.loaded == false and
  .marker.retained == true
' "$result_path" >/dev/null
[[ -f "$marker_path" ]]

write_marker "$marker_path" bat false
if HOME="$test_home" \
	REMOTE_SYSTEM_MARKER="$marker_path" \
	NIXMAC_E2E_REMOTE_RESTORE_PLAN_ONLY=true \
	bash "$restore_script" >/dev/null 2>&1; then
	echo "invalid restore marker unexpectedly passed" >&2
	exit 1
fi
jq -e '
  .status == "fail" and
  .planOnly == true and
  .marker.loaded == false and
  .marker.retained == true and
  (.errors | any(test("marker failed validation")))
' "$result_path" >/dev/null
[[ -f "$marker_path" ]]

# These assertions intentionally match literal shell variables.
# shellcheck disable=SC2016
grep -F '/usr/bin/sudo -n -H "$NIX_ENV_PATH" --profile "$PROFILE_PATH" --set "$ORIGINAL_SYSTEM"' "$restore_script" >/dev/null
# shellcheck disable=SC2016
grep -F '"$BREW_PATH" uninstall --force hello' "$restore_script" >/dev/null
# shellcheck disable=SC2016
grep -F '/usr/bin/sudo -n -l -- /bin/launchctl asuser "$gui_uid" "$ORIGINAL_SYSTEM/sw/bin/darwin-rebuild" activate' "$restore_script" >/dev/null
# shellcheck disable=SC2016
grep -F '/usr/bin/sudo -n -H /bin/launchctl asuser "$gui_uid"' "$restore_script" >/dev/null

# Exercise the real remediation decisions with command functions replaced by
# side-effect-free test doubles.
(
	export NIXMAC_E2E_REMOTE_RESTORE_LIBRARY_ONLY=true
	# shellcheck source=ops/scripts/e2e/remote-restore.sh
	source "$restore_script"
	set -euo pipefail
	marker_loaded=true
	system_preconditions_valid=true
	ORIGINAL_SYSTEM="$original_system"
	PROFILE_PATH="/nix/var/nix/profiles/system"
	MARKER_RUN_ID="self-test-1"
	read_active_system() { printf '%s\n' "$original_system"; }
	read_profile_store() { printf '%s\n' "$original_system"; }
	profile_called=false
	activate_called=false
	run_profile_set() { profile_called=true; }
	run_system_activate() { activate_called=true; }
	restore_original_system
	[[ "$profile_called" == "true" && "$activate_called" == "true" ]]
	[[ "$system_restore_attempted" == "true" && "$system_restored" == "true" ]]
)

(
	export NIXMAC_E2E_REMOTE_RESTORE_LIBRARY_ONLY=true
	# shellcheck source=ops/scripts/e2e/remote-restore.sh
	source "$restore_script"
	set -euo pipefail
	marker_loaded=true
	formula_preconditions_valid=true
	FORMULA_INSTALLED_BEFORE=false
	cleanup_status=1
	uninstall_called=false
	formula_artifact_present() { return 0; }
	run_formula_uninstall() { uninstall_called=true; }
	capture_formula_state() {
		formula_installed_after=false
		formula_executable_after=false
	}
	restore_formula_state
	[[ "$uninstall_called" == "true" && "$formula_restored" == "true" ]]
)

(
	export NIXMAC_E2E_REMOTE_RESTORE_LIBRARY_ONLY=true
	# shellcheck source=ops/scripts/e2e/remote-restore.sh
	source "$restore_script"
	set -euo pipefail
	REMOTE_SYSTEM_MARKER="$marker_path"
	calls=()
	write_terminal_result() { calls+=("write:$2"); }
	remove_restore_marker() { calls+=("remove"); }
	finalize_success_marker_evidence
	[[ "${calls[*]}" == "write:true remove write:false" ]]
)

(
	export NIXMAC_E2E_REMOTE_RESTORE_LIBRARY_ONLY=true
	# shellcheck source=ops/scripts/e2e/remote-restore.sh
	source "$restore_script"
	set -euo pipefail
	REMOTE_SYSTEM_MARKER="$marker_path"
	remove_called=false
	write_terminal_result() { return 1; }
	remove_restore_marker() { remove_called=true; }
	if finalize_success_marker_evidence; then
		echo "marker finalization unexpectedly passed after evidence-write failure" >&2
		exit 1
	fi
	[[ "$remove_called" == "false" && "$cleanup_status" -eq 1 ]]
)

(
	export NIXMAC_E2E_REMOTE_RESTORE_LIBRARY_ONLY=true
	# shellcheck source=ops/scripts/e2e/remote-restore.sh
	source "$restore_script"
	set -euo pipefail
	REMOTE_SYSTEM_MARKER="$marker_path"
	write_calls=0
	write_terminal_result() { write_calls=$((write_calls + 1)); }
	remove_restore_marker() { return 1; }
	if finalize_success_marker_evidence; then
		echo "marker finalization unexpectedly passed after marker-removal failure" >&2
		exit 1
	fi
	[[ "$write_calls" -eq 1 && "$cleanup_status" -eq 1 ]]
)

(
	export NIXMAC_E2E_REMOTE_RESTORE_LIBRARY_ONLY=true
	# shellcheck source=ops/scripts/e2e/remote-restore.sh
	source "$restore_script"
	set -euo pipefail
	REMOTE_SYSTEM_MARKER="$marker_path"
	calls=()
	write_calls=0
	write_terminal_result() {
		write_calls=$((write_calls + 1))
		calls+=("write:$2")
		[[ "$write_calls" -eq 1 ]]
	}
	remove_restore_marker() { calls+=("remove"); }
	if finalize_success_marker_evidence; then
		echo "marker finalization unexpectedly passed after terminal evidence-write failure" >&2
		exit 1
	fi
	[[ "${calls[*]}" == "write:true remove write:false" ]]
	[[ "$cleanup_status" -eq 1 ]]
)

echo "remote restore self-test passed"
