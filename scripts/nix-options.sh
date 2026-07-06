#!/usr/bin/env bash

# Generate structured Nix option metadata and browsable markdown docs.
#
# The JSON files are produced with pkgs.nixosOptionsDoc, which keeps option
# paths, descriptions, types, defaults, examples, locations, and declarations in
# a structured format. The smaller *-docs.json files are derived compatibility
# indexes for the native app's search_docs tool.

set -euo pipefail

SCRIPT_DIR=$(dirname "$0")
ROOT_DIR=$(dirname "$SCRIPT_DIR")
NIX_OPTIONS_DIR="$ROOT_DIR/apps/native/src-tauri/resources"
NIXOS_OPTIONS_FILE="$NIX_OPTIONS_DIR/nixos-options.json"
NIX_DARWIN_OPTIONS_FILE="$NIX_OPTIONS_DIR/nix-darwin-options.json"
HOME_MANAGER_OPTIONS_FILE="$NIX_OPTIONS_DIR/home-manager-options.json"

NIX_DARWIN_DOCS_FILE="$NIX_OPTIONS_DIR/nix-darwin-docs.json"
HOME_MANAGER_DOCS_FILE="$NIX_OPTIONS_DIR/home-manager-docs.json"
OPTIONS_TREE_DIR="$NIX_OPTIONS_DIR/options"

# Top-level categories that are large enough to warrant one extra level of
# nesting (one file per second-level subcategory) instead of a single file.
SPLIT_KEYS=(programs services)

generate_options_json() {
  local tool="$1"
  local out_file="$2"
  local eval_expr

  case "$tool" in
    nixos)
      eval_expr='
        eval = pkgs.nixos {
          _module.check = pkgs.lib.mkForce false;
          system.stateVersion = "23.11";
        };
      '
      ;;

    nix-darwin)
      eval_expr='
        flake = builtins.getFlake "github:nix-darwin/nix-darwin";
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
  pkgs = import <nixpkgs> {};

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

  mkdir -p "$(dirname "$out_file")"
  cp "$json_file" "$out_file"
}

generate_docs_index() {
  local options_file="$1"
  local docs_file="$2"

  python3 "$SCRIPT_DIR/generate-docs-index.py" "$options_file" "$docs_file"
}

build_tree() {
  local name="$1"
  local options_file="$2"

  python3 "$SCRIPT_DIR/build-options-tree.py" \
    "$name" \
    "$options_file" \
    "$OPTIONS_TREE_DIR/$name" \
    "${SPLIT_KEYS[@]}"
}

echo "Generating structured options JSON:"
generate_options_json "nixos" "$NIXOS_OPTIONS_FILE"
echo "  $NIXOS_OPTIONS_FILE"
generate_options_json "nix-darwin" "$NIX_DARWIN_OPTIONS_FILE"
echo "  $NIX_DARWIN_OPTIONS_FILE"
generate_options_json "home-manager" "$HOME_MANAGER_OPTIONS_FILE"
echo "  $HOME_MANAGER_OPTIONS_FILE"

echo "Generating app docs indexes:"
generate_docs_index "$NIX_DARWIN_OPTIONS_FILE" "$NIX_DARWIN_DOCS_FILE"
echo "  $NIX_DARWIN_DOCS_FILE"
generate_docs_index "$HOME_MANAGER_OPTIONS_FILE" "$HOME_MANAGER_DOCS_FILE"
echo "  $HOME_MANAGER_DOCS_FILE"

echo "Generating options docs under $OPTIONS_TREE_DIR (split: ${SPLIT_KEYS[*]}):"
build_tree "nixos" "$NIXOS_OPTIONS_FILE"
build_tree "nix-darwin" "$NIX_DARWIN_OPTIONS_FILE"
build_tree "home-manager" "$HOME_MANAGER_OPTIONS_FILE"
