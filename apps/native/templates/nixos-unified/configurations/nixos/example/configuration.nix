{
  boot.loader.grub.device = "nodev";
  fileSystems."/" = {
    device = "/dev/disk/by-label/nixos";
    fsType = "btrfs";
  };

  nixpkgs.hostPlatform = "x86_64-linux";
  networking.hostName = "example";

  system.stateVersion = "24.11";
}
