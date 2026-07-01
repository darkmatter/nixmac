{ flake, ... }:
let
  inherit (flake) inputs;
  inherit (inputs) self;
in
{
  imports = [
    self.darwinModules.default
  ];

  nixpkgs.hostPlatform = "PLATFORM_PLACEHOLDER";
  networking.hostName = "HOSTNAME_PLACEHOLDER";
  system.primaryUser = "USERNAME_PLACEHOLDER";

  home-manager.backupFileExtension = "nixmac-nixos-unified-backup";
  system.stateVersion = 4;
}
