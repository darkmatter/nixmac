{
  pkgs,
  lib,
  config,
  inputs,
  ...
}:
{
  cachix.enable = true;
  cachix.pull = [
    "nixpkgs"
    "devenv"
  ];
}
