# Home Manager modules - aggregates all common home configuration
{
  config,
  pkgs,
  lib,
  user,
  ...
}:

{
  imports = [
    # Programs
    ./programs/alacritty.nix
    ./programs/bat.nix
    ./programs/direnv.nix
    ./programs/fzf.nix
    ./programs/git.nix
    ./programs/go.nix
    ./programs/karabiner.nix
    ./programs/lazygit.nix
    ./programs/nvim.nix
    ./programs/raycast.nix
    ./programs/starship.nix
    ./programs/tmux.nix
    ./programs/zsh.nix

    # Misc
    ./xdg.nix
    ./theme.nix
    ./files.nix
  ];

  # Basic home configuration
  home = {
    username = user.username;
    homeDirectory = lib.mkForce user.homeDirectory;

    # Common user packages
    packages = with pkgs; [
      devenv
      goose-cli
    ];

    # Session variables
    sessionVariables = {
      EDITOR = "nvim";
      VISUAL = "nvim";
      PNPM_CACHE_DIR = "${config.home.homeDirectory}/.cache/pnpm";
      XDG_CACHE_HOME = "${config.home.homeDirectory}/.cache";
    };
  };

  # Enable XDG base directories
  xdg.enable = true;

  # Enable Catppuccin theme globally
  catppuccin = {
    enable = true;
    flavor = "mocha";
    accent = "blue";
  };
}
