{ ... }:
{
  imports = [
    ./nix
  ];

  cachix.enable = true;
  cachix.pull = [
    "darkmatter"
    "nixpkgs"
    "devenv"
  ];
}
