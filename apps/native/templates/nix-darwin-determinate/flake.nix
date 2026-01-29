{
  # Result of `nix flake init -t nix-darwin/master` command as documented in nix-darwin setup.
  description = "Example nix-darwin system flake";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    nix-darwin.url = "github:nix-darwin/nix-darwin/master";
    nix-darwin.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs =
    inputs@{
      self,
      nix-darwin,
      nixpkgs,
    }:
    let
      configuration =
        { pkgs, ... }:
        {
          networking.hostName = "Scotts-MacBook-Pro-2";

          # List packages installed in system profile. To search by name, run:
          # $ nix-env -qaP | grep wget
          environment.systemPackages = [
            pkgs.vim
          ];

          # Necessary for using flakes on this system.
          nix.settings.experimental-features = "nix-command flakes";

          # Enable alternative shell support in nix-darwin.
          # programs.fish.enable = true;

          # Set Git commit hash for darwin-version.
          system.configurationRevision = self.rev or self.dirtyRev or null;

          # Used for backwards compatibility, please read the changelog before changing.
          # $ darwin-rebuild changelog
          system.stateVersion = 6;

          # The platform the configuration will be used on.
          nixpkgs.hostPlatform = "aarch64-darwin";

          # Required for Determinate:
          nix.enable = false; # Disable nix-darwin’s Nix management
        };
    in
    {
      # Build darwin flake using:
      # $ darwin-rebuild build --flake .#Scotts-MacBook-Pro-2
      darwinConfigurations."Scotts-MacBook-Pro-2" = nix-darwin.lib.darwinSystem {
        modules = [
          configuration
          ./homebrew.nix
          ./environment.nix
          ./packages.nix
          ./services.nix
          ./users.nix
          ./networking.nix
          ./fonts.nix
          ./security.nix
          ./nix-overlays.nix
        ];
      };
    };
}
