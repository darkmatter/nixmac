#!/usr/bin/env bash

# Generate the compact search_docs compatibility index (nix-darwin-docs.json
# and home-manager-docs.json) from structured Nix option metadata produced by
# pkgs.nixosOptionsDoc.
#
# Only the *-docs.json files are consumed by the app (via include_str! in
# static_docs.rs). The structured *-options.json and the browsable markdown
# tree under resources/options/ are NOT used by the app, so we no longer
# generate or commit them. Raw options JSON is produced to a temp directory
# as an intermediate and discarded.

set -euo pipefail

SCRIPT_DIR=$(dirname "$0")
ROOT_DIR=$(dirname "$SCRIPT_DIR")
RESOURCES_DIR="$ROOT_DIR/apps/native/src-tauri/resources"
NIX_DARWIN_DOCS_FILE="$RESOURCES_DIR/nix-darwin-docs.json"
HOME_MANAGER_DOCS_FILE="$RESOURCES_DIR/home-manager-docs.json"


TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

NIX_DARWIN_OPTIONS_FILE="$TMP_DIR/nix-darwin-options.json"
HOME_MANAGER_OPTIONS_FILE="$TMP_DIR/home-manager-options.json"

generate_options_json() {
  local tool="$1"
  local out_file="$2"
  local eval_expr

  case "$tool" in
    nix-darwin)
      eval_expr='
        flake = builtins.getFlake "github:nix-darwin/nix-darwin";
        pkgs = import flake.inputs.nixpkgs {};
        eval = flake.lib.darwinSystem {
          inherit pkgs;
          modules = [{
            _module.check = false;
            networking.hostName = "dummy";
            networking.domain = "local";
          }];
        };
      '
      ;;

    home-manager)
      eval_expr='
        hm = builtins.getFlake "github:nix-community/home-manager";
        pkgs = import hm.inputs.nixpkgs {};
        eval = hm.lib.homeManagerConfiguration {
          inherit pkgs;
          modules = [{
            _module.check = pkgs.lib.mkForce false;
            home.stateVersion = "23.11";
            home.username = "user";
            home.homeDirectory = "/home/user";
          }];
        };
      '
      ;;

    *)
      echo "ERROR: unknown tool: $tool" >&2
      return 1
      ;;
  esac

  local expr
  expr=$(cat <<EOF
let
  ${eval_expr}

  optionsDoc = pkgs.nixosOptionsDoc {
    options = builtins.removeAttrs eval.options [ "_module" ];
  };
in
  optionsDoc.optionsJSON
EOF
)

  local out
  out=$(nix build --impure --no-link --print-out-paths --expr "$expr")

  local json_file
  json_file=$(find "$out" -type f -name 'options.json' | head -n 1)

  if [[ -z "${json_file:-}" ]]; then
    echo "ERROR: could not find options.json under $out" >&2
    find "$out" -maxdepth 5 -type f >&2
    return 1
  fi

  cp "$json_file" "$out_file"
}

generate_docs_index() {
  local options_file="$1"
  local docs_file="$2"

  python3 "$SCRIPT_DIR/generate-docs-index.py" "$options_file" "$docs_file"
}

echo "Generating structured options JSON (intermediate, temp):"
generate_options_json "nix-darwin" "$NIX_DARWIN_OPTIONS_FILE"
echo "  $NIX_DARWIN_OPTIONS_FILE"
generate_options_json "home-manager" "$HOME_MANAGER_OPTIONS_FILE"
echo "  $HOME_MANAGER_OPTIONS_FILE"

echo "Generating app docs indexes into $RESOURCES_DIR:"
generate_docs_index "$NIX_DARWIN_OPTIONS_FILE" "$NIX_DARWIN_DOCS_FILE"
echo "  $NIX_DARWIN_DOCS_FILE"
generate_docs_index "$HOME_MANAGER_OPTIONS_FILE" "$HOME_MANAGER_DOCS_FILE"
echo "  $HOME_MANAGER_DOCS_FILE"
