#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKSPACE_USER="${SUDO_USER:-$(id -un)}"
WORKSPACE_HOME="$(getent passwd "$WORKSPACE_USER" | cut -d: -f6)"
if [ -z "$WORKSPACE_HOME" ]; then
  WORKSPACE_HOME="/home/$WORKSPACE_USER"
fi

NIX_INSTALLER_URL="https://install.determinate.systems/nix"
DEVENV_FLAKE="github:cachix/devenv/v1.11.1"
NIX_CUSTOM_CONF="/etc/nix/nix.custom.conf"
MANAGED_BEGIN="# BEGIN nixmac cursor bootstrap"
MANAGED_END="# END nixmac cursor bootstrap"

log() {
  printf '[cursor-bootstrap] %s\n' "$*"
}

run_as_workspace_user() {
  if [ "$(id -un)" = "$WORKSPACE_USER" ]; then
    "$@"
    return
  fi

  sudo -H -u "$WORKSPACE_USER" env "HOME=$WORKSPACE_HOME" "PATH=$PATH" "$@"
}

ensure_path_entries() {
  export PATH="$WORKSPACE_HOME/.nix-profile/bin:/nix/var/nix/profiles/default/bin:$PATH"
}

source_nix() {
  local candidate

  ensure_path_entries

  for candidate in \
    "/nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh" \
    "$WORKSPACE_HOME/.nix-profile/etc/profile.d/nix.sh" \
    "/etc/profile.d/nix.sh"
  do
    if [ -r "$candidate" ]; then
      # shellcheck disable=SC1090
      . "$candidate"
      ensure_path_entries
    fi
  done
}

ensure_nix() {
  if command -v nix >/dev/null 2>&1; then
    log "Nix already installed"
    source_nix
    return
  fi

  log "Installing Determinate Nix"
  curl --proto '=https' --tlsv1.2 -sSf -L "$NIX_INSTALLER_URL" | sh -s -- install --no-confirm
  source_nix

  if ! command -v nix >/dev/null 2>&1; then
    log "Failed to make nix available after installation"
    exit 1
  fi
}

write_trusted_users_config() {
  local managed_block
  local tmp_file

  managed_block="$(printf '%s\ntrusted-users = root %s\n%s\n' "$MANAGED_BEGIN" "$WORKSPACE_USER" "$MANAGED_END")"
  tmp_file="$(mktemp)"

  sudo python3 - "$NIX_CUSTOM_CONF" "$MANAGED_BEGIN" "$MANAGED_END" "$managed_block" >"$tmp_file" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
begin = sys.argv[2]
end = sys.argv[3]
block = sys.argv[4]
content = path.read_text() if path.exists() else ""

begin_marker = f"{begin}\n"
end_marker = f"{end}\n"
block_with_newline = block if block.endswith("\n") else f"{block}\n"

if begin_marker in content and end_marker in content:
    start = content.index(begin_marker)
    finish = content.index(end_marker, start) + len(end_marker)
    new_content = f"{content[:start]}{block_with_newline}{content[finish:]}"
else:
    suffix = "" if content.endswith("\n") or not content else "\n"
    new_content = f"{content}{suffix}{block_with_newline}"

sys.stdout.write(new_content)
PY

  if [ -f "$NIX_CUSTOM_CONF" ] && cmp -s "$tmp_file" "$NIX_CUSTOM_CONF"; then
    rm -f "$tmp_file"
    log "Trusted users config already up to date"
    return
  fi

  sudo mkdir -p /etc/nix
  sudo install -m 0644 "$tmp_file" "$NIX_CUSTOM_CONF"
  rm -f "$tmp_file"

  log "Updated $NIX_CUSTOM_CONF"
  restart_nix_daemon
}

restart_nix_daemon() {
  if ! command -v systemctl >/dev/null 2>&1; then
    log "systemctl unavailable; skipping Nix daemon restart"
    return
  fi

  sudo systemctl daemon-reload >/dev/null 2>&1 || true

  for unit in nix-daemon.service determinate-nixd.service nix-daemon.socket determinate-nixd.socket; do
    if sudo systemctl restart "$unit" >/dev/null 2>&1; then
      log "Restarted $unit"
      return
    fi
  done

  log "Could not restart a known Nix daemon unit; continuing"
}

ensure_devenv() {
  source_nix

  if command -v devenv >/dev/null 2>&1; then
    log "devenv already installed"
    return
  fi

  log "Installing devenv from $DEVENV_FLAKE"
  run_as_workspace_user nix profile install --accept-flake-config "$DEVENV_FLAKE"
  source_nix

  if ! command -v devenv >/dev/null 2>&1; then
    log "Failed to make devenv available after installation"
    exit 1
  fi
}

warm_devenv_shell() {
  log "Evaluating devenv shell"
  run_as_workspace_user bash -lc "cd \"$ROOT_DIR\" && PATH=\"$PATH\" devenv shell -- true"
}

ensure_dependencies() {
  if [ -d "$ROOT_DIR/node_modules" ]; then
    log "node_modules already present; skipping dependency install"
    return
  fi

  log "Installing Bun dependencies inside devenv shell"
  run_as_workspace_user bash -lc "cd \"$ROOT_DIR\" && PATH=\"$PATH\" devenv shell -- bun install --frozen-lockfile"
}

main() {
  log "Preparing environment for workspace user '$WORKSPACE_USER'"
  ensure_nix
  write_trusted_users_config
  ensure_devenv
  warm_devenv_shell
  ensure_dependencies
  log "Bootstrap complete"
}

main "$@"
