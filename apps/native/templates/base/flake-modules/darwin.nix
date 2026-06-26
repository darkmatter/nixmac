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
      "HOSTNAME_PLACEHOLDER" = inputs.darwin.lib.darwinSystem {
        system = "PLATFORM_PLACEHOLDER";
        specialArgs = {
          inherit inputs self;
          hostname = "HOSTNAME_PLACEHOLDER";
          user = users.USERNAME_PLACEHOLDER;
        };
        modules = [
          # Core darwin modules
          ../modules/darwin

          # Host-specific configuration
          ../hosts/HOSTNAME_PLACEHOLDER

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
                hostname = "HOSTNAME_PLACEHOLDER";
                user = users.USERNAME_PLACEHOLDER;
              };
              users.${users.USERNAME_PLACEHOLDER.username} = {
                imports = [
                  ../hosts/HOSTNAME_PLACEHOLDER/home.nix
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
