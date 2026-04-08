{
  description = "Nixmac — macOS configuration toolkit";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    stackpanel.url = "github:darkmatter/stackpanel";
    devenv.url = "github:cachix/devenv/2.0.0";

    # For pure flake evaluation in CI and nix flake show/check.
    stackpanel-root.url = "file+file:///dev/null";
    stackpanel-root.flake = false;
  };

  outputs = { self, stackpanel, ... }@inputs: stackpanel.lib.mkFlake { inherit inputs self; };
}
