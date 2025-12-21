#!/usr/bin/env bash

#
# Development shell loader
#
# Loader for IDEs like VS Code to start a shell inside a Nix-based development environment.
# Handles common edge cases like Nix not being in PATH yet.
# set -euo pipefail
export DIRENV_DISABLE=1

# --- small helpers
die() { printf "devshell: %s\n" "$*" >&2; exit 1; }

# Avoid recursion if VS Code reuses this profile inside itself
if [[ "${DEVENV_VSCODE_SHELL:-}" == "1" ]]; then
  # If we're already inside, just start a login shell.
  exec "${SHELL:-/bin/bash}" -l
fi
export DEVENV_VSCODE_SHELL=1

# Ensure nix is available
if ! command -v nix >/dev/null 2>&1; then
  if [[ -e /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh ]]; then
    # shellcheck disable=SC1091
    . /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh
  elif [[ -e "$HOME/.nix-profile/etc/profile.d/nix.sh" ]]; then
    # shellcheck disable=SC1091
    . "$HOME/.nix-profile/etc/profile.d/nix.sh"
  elif [[ -e /etc/profile.d/nix.sh ]]; then
    # shellcheck disable=SC1091
    . /etc/profile.d/nix.sh
  fi
fi
command -v nix >/dev/null 2>&1 || die "nix not found, install it: https://install.determinate.systems"

# Find the right project root so devenv sees devenv.yaml + devenv.lock
find_root() {
  # Prefer git root if available
  if command -v git >/dev/null 2>&1; then
    local gr
    gr="$(git rev-parse --show-toplevel 2>/dev/null || true)"
    if [[ -n "$gr" && -f "$gr/devenv.yaml" ]]; then
      printf "%s\n" "$gr"
      return 0
    fi
  fi

  # Walk up from current dir
  local d="$PWD"
  while [[ "$d" != "/" ]]; do
    if [[ -f "$d/devenv.yaml" ]]; then
      printf "%s\n" "$d"
      return 0
    fi
    d="$(dirname "$d")"
  done

  die "couldn't find devenv.yaml (set DEVENV_ROOT or open VS Code at the repo root)"
}

ROOT="$(find_root)"
cd "$ROOT"

# Pin devenv executable; devenv.lock will pin the project's inputs.
# Force bash shell to avoid starship prompt issues with zsh
# (devenv enterShell runs starship init for bash, so we need to stay in bash)

exec nix run --accept-flake-config github:cachix/devenv/v1.11.1 -- shell
