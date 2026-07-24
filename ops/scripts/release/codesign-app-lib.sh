# shellcheck shell=bash
# Shared codesign routine for every packaged copy of nixmac.app (standalone
# bundle, DMG contents, updater tarball contents). Source this file; do not
# execute it.
#
# The helper and its clients authenticate each other by signing requirement
# (privileged_helper/peer_auth.rs), which pins nested code identifiers and the
# certificate team OU to the NIXMAC_TEAM_ID the binaries were compiled with —
# build.rs embeds it from the checked-in signing-team-id file (env override
# wins, matching build.rs). Any script that signs an app copy MUST use this
# routine: signing a copy with --deep or without the pinned identifiers ships
# an artifact whose helper authentication fails at runtime.

NIXMAC_CODESIGN_LIB_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
NIXMAC_CODESIGN_REPO_ROOT=$(cd "$NIXMAC_CODESIGN_LIB_DIR/../../.." && pwd)
NIXMAC_ENTITLEMENTS_DIR="$NIXMAC_CODESIGN_REPO_ROOT/apps/native/src-tauri"

nixmac_expected_team_id() {
	printf '%s\n' "${NIXMAC_TEAM_ID:-$(tr -d '[:space:]' <"$NIXMAC_ENTITLEMENTS_DIR/signing-team-id")}"
}

# Refuse to sign with a certificate from a team other than the one the
# binaries were built with: the peer handshake would fail closed at runtime.
# For a "Developer ID Application" identity the parenthetical in the name is
# the team identifier (they only diverge for free personal teams, which
# cannot hold Developer ID certificates).
nixmac_require_identity_team() {
	local identity="$1"
	local team_id
	local cert_team_id

	team_id=$(nixmac_expected_team_id)
	cert_team_id=$(printf '%s' "$identity" | sed -n 's/.*(\([A-Z0-9]*\))$/\1/p')
	if [ -z "$team_id" ] || [ "$cert_team_id" != "$team_id" ]; then
		echo "ERROR: certificate team '$cert_team_id' does not match NIXMAC_TEAM_ID '$team_id' the binaries were built with" >&2
		return 1
	fi
}

# Sign an app bundle inside-out: nested binaries first with explicit code
# identifiers (-i) and per-binary entitlements — peer_auth.rs pins these
# identifiers, and without -i codesign derives the identifier from the file
# name, so the requirement never matches — then the outer bundle WITHOUT
# --deep, which would re-sign the nested binaries and clobber their explicit
# identifiers and entitlements.
#
# An ad-hoc identity ("-") signs with the same pinned identifiers but no
# entitlements or hardened runtime: helper authentication cannot succeed
# without a team anyway, and AMFI kills an app launched ad-hoc with the
# restricted helper-client entitlement.
nixmac_sign_app_inside_out() {
	local app_path="$1"
	local identity="$2"
	local macos_dir="$app_path/Contents/MacOS"
	local helper

	for helper in nixmac-helper nixmac-sync-agent; do
		if [ ! -f "$macos_dir/$helper" ]; then
			echo "ERROR: nested binary missing from bundle: $macos_dir/$helper" >&2
			return 1
		fi
	done

	if [ "$identity" = "-" ]; then
		echo "Ad-hoc signing nested helper: $macos_dir/nixmac-helper"
		codesign --force \
			--identifier com.darkmatter.nixmac.helper \
			--sign - \
			"$macos_dir/nixmac-helper"

		echo "Ad-hoc signing nested sync agent: $macos_dir/nixmac-sync-agent"
		codesign --force \
			--identifier com.darkmatter.nixmac.sync-agent \
			--sign - \
			"$macos_dir/nixmac-sync-agent"

		codesign --force --sign - "$app_path"
		return 0
	fi

	nixmac_require_identity_team "$identity"

	echo "Signing nested helper: $macos_dir/nixmac-helper"
	codesign --force --options runtime \
		--identifier com.darkmatter.nixmac.helper \
		--entitlements "$NIXMAC_ENTITLEMENTS_DIR/entitlements-helper.plist" \
		--sign "$identity" \
		"$macos_dir/nixmac-helper"

	echo "Signing nested sync agent: $macos_dir/nixmac-sync-agent"
	codesign --force --options runtime \
		--identifier com.darkmatter.nixmac.sync-agent \
		--entitlements "$NIXMAC_ENTITLEMENTS_DIR/entitlements-helper-client.plist" \
		--sign "$identity" \
		"$macos_dir/nixmac-sync-agent"

	codesign --force --options runtime \
		--entitlements "$NIXMAC_ENTITLEMENTS_DIR/entitlements.plist" \
		--sign "$identity" \
		"$app_path"
}
