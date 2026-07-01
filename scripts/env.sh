#!/usr/bin/env bash
set -euo pipefail

# Source this script to set up the environment for the nixmac repository.
#
# Usage:
#   source scripts/env.sh
#
# This script will set up the environment for the nixmac repository.
# It will set up the environment variables for the nixmac repository.
# It will set up the environment variables for the nixmac repository.

check_dependencies() {
  if ! command -v sops >/dev/null 2>&1; then
    echo "sops is not installed"
    exit 1
  fi
  if ! command -v age >/dev/null 2>&1; then
    echo "age is not installed"
    exit 1
  fi
  if ! command -v git >/dev/null 2>&1; then
    echo "git is not installed"
    exit 1
  fi
}

check_already_sourced() {
  if [ -n "${ALREADY_SOURCED:-}" ]; then
    echo "env.sh has already been sourced"
    exit 1
  fi
  export ALREADY_SOURCED=1
}

select_env() {
  SELECTED_ENV="${NIXMAC_ENV:-}"
  CHOOSE_MSG="\
No environment selected, which \
environment do you want to use?"
  if [ -z "$SELECTED_ENV" ]; then
    SELECTED_ENV="$(gum choose "prod" "dev" --header="$CHOOSE_MSG")"
  fi
  export NIXMAC_ENV="$SELECTED_ENV"
}

get_secrets_file() {
  if [ "$NIXMAC_ENV" == "prod" ]; then
    echo "ops/secrets/secrets.yaml"
  else
    echo "ops/secrets/secrets.dev.yaml"
  fi
}

check_dependencies
check_already_sourced
select_env


exec sops exec-env $
echo "Environment set up successfully"