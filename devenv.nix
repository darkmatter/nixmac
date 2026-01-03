{
  pkgs,
  lib,
  config,
  inputs,
  ...
}:
{
  imports = [
    # TODO: Re-enable after fixing stackpanel FlakeHub release
    # The published version has incorrect paths (nix/modules/devenv doesn't exist)
    ./infra/nix
  ];
  # stackpanel.devshell.hooks.main = [
  #   ''
  #     echo "Hello, World!"
  #   ''
  # ];
  # stackpanel.enable = true;
  cachix.enable = true;
  cachix.pull = [
    "nixpkgs"
    "darkmatter"
    "devenv"
  ];
}
