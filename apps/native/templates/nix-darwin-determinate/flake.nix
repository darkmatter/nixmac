{
  # Result of `nix flake init -t nix-darwin/master` command as documented in nix-darwin setup.
  description = "Example nix-darwin system flake";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    nix-darwin.url = "github:nix-darwin/nix-darwin/master";
    nix-darwin.inputs.nixpkgs.follows = "nixpkgs";

    # ============================================================================
    # home-manager (OPTIONAL - currently commented out)
    # ============================================================================
    # home-manager manages user-level configuration files (dotfiles) declaratively.
    # It's useful for managing configs like .zshrc, .gitconfig, vim settings, etc.
    #
    # To enable home-manager:
    # 1. Uncomment the lines below
    # 2. Add home-manager.darwinModules.home-manager to the modules list
    # 3. Configure it in a separate home.nix or within your configuration
    #
    # See: https://nix-community.github.io/home-manager/
    #
    # inputs.home-manager = {
    #   url = "github:nix-community/home-manager";
    #   inputs.nixpkgs.follows = "nixpkgs";
    # };
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
          networking.hostName = "HOSTNAME_PLACEHOLDER";

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
          # This will be automatically detected during bootstrap
          nixpkgs.hostPlatform = "PLATFORM_PLACEHOLDER";

          # Required for Determinate:
          nix.enable = false; # Disable nix-darwin’s Nix management
        };
    in
    {
      # Build darwin flake using:
      # $ darwin-rebuild build --flake .#HOSTNAME_PLACEHOLDER
      darwinConfigurations."HOSTNAME_PLACEHOLDER" = nix-darwin.lib.darwinSystem {
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
