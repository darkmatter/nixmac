# Homebrew configuration
{ config, pkgs, lib, ... }:

{
  homebrew = {
    enable = true;

    taps = [
      "dotenvx/brew"
      "peak/tap"
    ];

    brews = [
      "dotenvx"
      "rcm"
      "mackup"
      "aircrack-ng"
      "peak/tap/s5cmd"
    ];

    casks = [
      # Development
      "docker-desktop"
      "visual-studio-code"
      "cursor"
      "warp"
      "tableplus"

      # Browsers & Communication
      "google-chrome"
      "slack"

      # Productivity
      "1password"
      "1password-cli"
      "rectangle"
      "raycast"
      "maccy"
      "notion"
      "figma"
      "chatgpt"
      "claude"

      # Utilities
      "tailscale"
      "dropbox"
      "karabiner-elements"

      # Fonts
      "font-source-code-pro"
      "font-courier-prime"
      "font-monaspice-nerd-font"
      "font-monaspace"
      "font-geist-mono"
      "font-meslo-lg-nerd-font"
    ];

    onActivation = {
      autoUpdate = true;
      upgrade = true;
      cleanup = "uninstall";
    };
  };
}

