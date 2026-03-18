# nixos-unified

This template is based on [`juspay/nixos-unified-template`](https://github.com/juspay/nixos-unified-template)
and is intended for cross-platform testing on Linux and macOS.

## What it includes

- `home-manager` configuration
- `nix-darwin` configuration
- `NixOS` configuration
- A default `nix run` activation path via `nixos-unified`

## Quick usage

1. Copy this directory as your flake root.
1. Update usernames/emails in `configurations/home/runner.nix`.
1. Update host definitions under:
   - `configurations/darwin/example.nix`
   - `configurations/nixos/example/`
1. Run `nix run` from the flake root.
