{ flake, ... }:
let
  inherit (flake) inputs;
  inherit (inputs) self;
in
{
  imports = [
    self.darwinModules.default
  ];

  # For Apple Silicon use aarch64-darwin.
  # For Intel Macs use x86_64-darwin.
  nixpkgs.hostPlatform = "aarch64-darwin";
  networking.hostName = "example";
  system.primaryUser = "runner";

  home-manager.backupFileExtension = "nixmac-nixos-unified-backup";
  system.stateVersion = 4;
}
