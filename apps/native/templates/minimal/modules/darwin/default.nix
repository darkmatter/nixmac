# Darwin modules - aggregates all darwin configuration modules
{ ... }:

{
  imports = [
    ./core.nix
    ./packages.nix
    ./homebrew.nix
    ./fonts.nix
    ./defaults.nix
  ];
}

