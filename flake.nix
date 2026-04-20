# ==============================================================================
# flake.nix
#
# Starter flake template for projects using stackpanel.
#
# Getting started:
#   1. Run: nix flake init -t git+ssh://git@github.com/darkmatter/stackpanel
#   2. Run: direnv allow
#   3. Configure stackpanel in ./.stack/config.nix
#
# Shell options:
#   nix develop     # Pure stackpanel shell (fast, reproducible)
#   devenv shell    # Devenv shell with languages/services (if .stack/devenv.nix exists)
#
# The lib.mkFlake function:
#   - Auto-loads .stack/config.nix
#   - Creates devShells.default via pkgs.mkShell
#   - Exposes stackpanelConfig, stackpanelFullConfig, stackpanelPackages
# ==============================================================================
{
  description = "My project powered by stackpanel";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    stackpanel.url = "github:darkmatter/stackpanel";
    devenv.url = "github:cachix/devenv/d15f117eb9aee15223c8fbccd88ccb4dcc2a1103";

    # For pure flake evaluation in CI and nix flake show/check.
    stackpanel-root.url = "file+file:///dev/null";
    stackpanel-root.flake = false;
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      stackpanel,
      ...
    }@inputs:
    # Use stackpanel.lib.mkFlake for full stackpanel integration
    # stackpanel.lib.mkFlake { inherit inputs self; }
    # Merge with additional custom outputs
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        # Add your own packages here
        packages.hello = pkgs.hello;
      }
    );
}
