# Standalone home-manager configurations (for non-darwin systems)
{ inputs, self, ... }:

let
  users = import ../users;
in
{
  flake = {
    homeConfigurations = {
      "USERNAME_PLACEHOLDER@macbook-pro" = inputs.home-manager.lib.homeManagerConfiguration {
        pkgs = inputs.nixpkgs.legacyPackages.aarch64-darwin;
        extraSpecialArgs = {
          inherit inputs self;
          hostname = "macbook-pro";
          user = users.USERNAME_PLACEHOLDER;
        };
        modules = [
          ../hosts/macbook-pro/home.nix
          inputs.catppuccin.homeModules.catppuccin
        ];
      };

      "USERNAME_PLACEHOLDER@mac-pro" = inputs.home-manager.lib.homeManagerConfiguration {
        pkgs = inputs.nixpkgs.legacyPackages.aarch64-darwin;
        extraSpecialArgs = {
          inherit inputs self;
          hostname = "mac-pro";
          user = users.USERNAME_PLACEHOLDER;
        };
        modules = [
          ../hosts/mac-pro/home.nix
          inputs.catppuccin.homeModules.catppuccin
        ];
      };
    };
  };
}
