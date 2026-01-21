{ pkgs, inputs, ... }:

{
  services.nix-daemon.enable = true;

  nix = {
    registry.nixpkgs.flake = inputs.nixpkgs;
    nixPath = [ "nixpkgs=${inputs.nixpkgs}" ];
    settings.experimental-features = [ "nix-command" "flakes" ];
  };
}
