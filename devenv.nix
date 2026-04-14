{
  pkgs,
  lib,
  config,
  inputs,
  ...
}:
{
  imports = [
    ./nix
  ];

  cachix.enable = true;
  cachix.pull = [
    "nixpkgs"
    "devenv"
  ];
}
