#!/usr/bin/env bash
set -euo pipefail

# Decrypt SOPS-encrypted E2E secrets and mask them in GitHub Actions.
#
# Required env vars:
#   SOPS_AGE_KEY  - Age key for SOPS decryption
#
# Outputs (via GITHUB_ENV if set):
#   MAC_E2E_HOST, MAC_E2E_USER, MAC_E2E_ADMIN_PW
# Also writes /tmp/e2e_ssh_key with mode 600.

SECRETS_FILE="ops/secrets/e2e.enc.yaml"
if [ ! -f "$SECRETS_FILE" ]; then
	echo "::error::SOPS secrets file not found at $SECRETS_FILE"
	exit 1
fi

MAC_E2E_HOST=$(sops -d --extract '["mac_host"]' "$SECRETS_FILE")
MAC_E2E_USER=$(sops -d --extract '["mac_user"]' "$SECRETS_FILE")
MAC_E2E_ADMIN_PW=$(sops -d --extract '["mac_admin_pw"]' "$SECRETS_FILE")

echo "::add-mask::$MAC_E2E_HOST"
echo "::add-mask::$MAC_E2E_USER"
echo "::add-mask::$MAC_E2E_ADMIN_PW"

if [[ -n "${GITHUB_ENV:-}" ]]; then
	{
		echo "MAC_E2E_HOST=$MAC_E2E_HOST"
		echo "MAC_E2E_USER=$MAC_E2E_USER"
		echo "MAC_E2E_ADMIN_PW=$MAC_E2E_ADMIN_PW"
	} >>"$GITHUB_ENV"
fi

sops -d --extract '["mac_ssh_key"]' "$SECRETS_FILE" >/tmp/e2e_ssh_key
chmod 600 /tmp/e2e_ssh_key
