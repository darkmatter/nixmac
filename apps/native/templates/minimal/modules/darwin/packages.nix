# System packages and custom scripts
{ config, pkgs, lib, inputs, user, ... }:

{
  environment.systemPackages = with pkgs; [
    # Core utilities
    coreutils
    tmux
    git
    curl
    wget
    tree
    watch

    # CLI Tools
    awscli2
    chamber

    # Development tools
    go
    nodejs
    kubectl
    biome
    aws-vault
    terraform
    gh
    direnv
    inputs.flox.packages.${pkgs.system}.default

    # Terminal enhancements
    ripgrep
    fd
    bat
    eza
    htop
    jq

    # Applications
    act
    alacritty
    stats
    lazygit
    postgresql
    ollama
    discord
    claude-code
    betterdisplay
    bun

    # Darwin management script
    (pkgs.writeShellScriptBin "darwin" (builtins.readFile ./scripts/darwin-cli.sh))

    # Backward compatibility aliases
    (pkgs.writeShellScriptBin "osxup" ''
      #!/usr/bin/env bash
      exec darwin apply "$@"
    '')

    (pkgs.writeShellScriptBin "darwinup" ''
      #!/usr/bin/env bash
      exec darwin apply "$@"
    '')

    # Package search utility
    (pkgs.writeShellScriptBin "pkg?" (builtins.readFile ./scripts/pkg-search.sh))
  ];
}

