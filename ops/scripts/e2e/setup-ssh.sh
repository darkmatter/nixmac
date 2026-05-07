#!/usr/bin/env bash
set -euo pipefail

# Set up SSH key for E2E remote access.
#
# Requires /tmp/e2e_ssh_key from decrypt-secrets.sh.
# Requires MAC_E2E_HOST env var for known_hosts.

mkdir -p ~/.ssh
cp /tmp/e2e_ssh_key ~/.ssh/e2e_key
chmod 600 ~/.ssh/e2e_key

if ! ssh-keygen -l -f ~/.ssh/e2e_key >/dev/null 2>&1; then
	echo "::error::SSH key appears invalid. Check SOPS encryption."
	head -1 ~/.ssh/e2e_key
	wc -l ~/.ssh/e2e_key
	exit 1
fi

ssh-keyscan -H "${MAC_E2E_HOST}" >>~/.ssh/known_hosts 2>/dev/null || true
