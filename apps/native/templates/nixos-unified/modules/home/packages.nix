{ pkgs, ... }:
{
  home.packages = with pkgs; [
    git
    vim
    ripgrep
    fd
    jq
    tree
  ];
}
