# File symlinking configuration
# Source files live in darwin/files/ and get symlinked into ~
{
  config,
  lib,
  self,
  ...
}:

let
  # Absolute path to files directory (for out-of-store symlinks)
  # This points directly to your repo, not the Nix store
  filesDir = "${config.home.homeDirectory}/darwin/files";

  # Helper for creating writable symlinks (points to repo, not store)
  mkWritableSymlink = path: config.lib.file.mkOutOfStoreSymlink path;
in
{
  # ============================================
  # READ-ONLY FILES (symlinked via Nix store)
  # ============================================

  xdg.configFile = {
    # 1Password SSH agent config
    "1Password/ssh" = lib.mkIf (builtins.pathExists "${self}/files/config/1Password") {
      source = "${self}/files/config/1Password/ssh";
      recursive = true;
    };

    # GitHub CLI config
    "gh" = lib.mkIf (builtins.pathExists "${self}/files/config/gh") {
      source = "${self}/files/config/gh";
      recursive = true;
    };
  };

  home.file = {
    # Zsh functions (read-only is fine)
    ".zsh/functions" = {
      source = "${self}/files/zsh/functions";
      recursive = true;
    };

    # Zsh completions
    ".zsh/completion" = {
      source = "${self}/files/zsh/completion";
      recursive = true;
    };

    # Legacy vim config
    ".vimrc" = lib.mkIf (builtins.pathExists "${self}/files/dotfiles/vimrc") {
      source = "${self}/files/dotfiles/vimrc";
    };

    ".vimrc.bundles" = lib.mkIf (builtins.pathExists "${self}/files/dotfiles/vimrc.bundles") {
      source = "${self}/files/dotfiles/vimrc.bundles";
    };

    # ============================================
    # WRITABLE FILES (out-of-store symlinks)
    # ============================================
    # These point directly to your repo, so programs can write to them

    # Karabiner config (needs write access)
    ".config/karabiner" = {
      source = mkWritableSymlink "${filesDir}/config/karabiner";
    };

    # Raycast preferences (needs write access)
    ".config/raycast" = {
      source = mkWritableSymlink "${filesDir}/config/raycast";
    };
  };
}
