# Standalone home-manager configurations (for non-darwin systems)
{ inputs, self, ... }:

let
  users = import ../users;
in
{
  flake = {
    homeConfigurations = {
      "USERNAME_PLACEHOLDER@HOSTNAME_PLACEHOLDER" = inputs.home-manager.lib.homeManagerConfiguration {
        pkgs = inputs.nixpkgs.legacyPackages.aarch64-darwin;
        extraSpecialArgs = {
          inherit inputs self;
          hostname = "HOSTNAME_PLACEHOLDER";
          user = users.USERNAME_PLACEHOLDER;
        };
        modules = [
          ../hosts/HOSTNAME_PLACEHOLDER/home.nix
          inputs.catppuccin.homeModules.catppuccin
        ];
      };
    };
  };
}
