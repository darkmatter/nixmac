{ pkgs, ... }:
{
  projectRootFile = "flake.nix";
  programs.nixfmt.enable = true;
  programs.nixfmt.package = pkgs.nixfmt-rfc-style;
  programs.shellcheck.enable = true;
  programs.oxfmt.enable = true;
}
