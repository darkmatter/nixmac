# Bat (better cat) configuration
{
  config,
  pkgs,
  lib,
  ...
}:

{
  programs.bat = {
    enable = true;
    config = {
      # Theme is set automatically by catppuccin module
      # (see catppuccin.enable in default.nix)
      style = "numbers,changes,header";
      pager = "less -FR";
    };
  };
}
