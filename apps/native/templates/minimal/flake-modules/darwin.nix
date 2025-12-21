# Darwin system configurations
{ inputs, self, ... }:

let
  # Load user profiles
  users = import ../users;
in
{
  flake = {
    # Darwin system configurations
    darwinConfigurations = {
      "macbook-pro" = inputs.darwin.lib.darwinSystem {
        system = "aarch64-darwin";
        specialArgs = {
          inherit inputs self;
          hostname = "macbook-pro";
          user = users.cooperm;
        };
        modules = [
          # Core darwin modules
          ../modules/darwin

          # Host-specific configuration
          ../hosts/macbook-pro

          # Determinate Nix
          inputs.determinate.darwinModules.default

          # Home Manager integration
          inputs.home-manager.darwinModules.home-manager
          {
            home-manager = {
              useGlobalPkgs = true;
              useUserPackages = true;
              backupFileExtension = "backup";
              extraSpecialArgs = {
                inherit inputs self;
                hostname = "macbook-pro";
                user = users.cooperm;
              };
              users.${users.coopermaruyama.username} = {
                imports = [
                  ../hosts/macbook-pro/home.nix
                  inputs.catppuccin.homeModules.catppuccin
                ];
              };
            };
          }
        ];
      };

      "mac-pro" = inputs.darwin.lib.darwinSystem {
        system = "aarch64-darwin";
        specialArgs = {
          inherit inputs self;
          hostname = "mac-pro";
          user = users.cooperm;
        };
        modules = [
          ../modules/darwin
          ../hosts/mac-pro
          inputs.determinate.darwinModules.default
          inputs.home-manager.darwinModules.home-manager
          {
            home-manager = {
              useGlobalPkgs = true;
              useUserPackages = true;
              backupFileExtension = "backup";
              extraSpecialArgs = {
                inherit inputs self;
                hostname = "mac-pro";
                user = users.cooperm;
              };
              users.${users.coopermaruyama.username} = {
                imports = [
                  ../hosts/mac-pro/home.nix
                  inputs.catppuccin.homeModules.catppuccin
                ];
              };
            };
          }
        ];
      };
    };
  };
}

