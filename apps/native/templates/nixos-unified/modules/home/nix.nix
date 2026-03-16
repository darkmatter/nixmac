{ config, pkgs, lib, ... }:
{
  nix.package = lib.mkDefault pkgs.nix;
  home.packages = [
    config.nix.package
  ];
}
