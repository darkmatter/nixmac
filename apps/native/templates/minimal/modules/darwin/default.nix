# Darwin modules - aggregates all darwin configuration modules
{ ... }:

{
  imports = [
    ../../.nixmac
    ./core.nix
    ./packages.nix
    ./fonts.nix
    ./defaults.nix
  ];
}
