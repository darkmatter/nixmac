{
  pkgs,
  lib,
  config,
  inputs,
  ...
}:
{
  imports = [
    ./infra/nix
  ];

  # stackpanel.enable = true;
}
