{ config, pkgs, ... }:

{
  # Homebrew module (nix-darwin)
  # Purpose:
  # - Central place to declare Homebrew `packages` and `casks` that should be
  #   installed on this machine via Homebrew.
  # - Keep Homebrew-managed items separate from pure Nix-managed packages.
  #
  # Usage notes for humans and AIs:
  # - Edit the `brews` list to include Homebrew formula names as strings, e.g.
  #   "git", "curl", etc.
  # - Edit the `casks` list to include Homebrew Cask tokens as strings, e.g.
  #   "google-chrome" or "visual-studio-code".
  # - Do NOT toggle `homebrew.enable` here. Set `homebrew.enable = true` in
  #   your top-level `flake.nix` configuration so there's a single source of
  #   truth for enabling Homebrew management.
  #
  # Safety and idempotency:
  # - Enabling Homebrew via nix-darwin will ensure the listed casks/packages
  #   are present, but it does not automatically uninstall packages you installed
  #   previously by hand. Avoid scripts that remove existing prefixes unless
  #   you explicitly intend to migrate.
  # - When adding items, include a short comment explaining why the item exists
  #   (helps reviewers and automated tools decide whether it's necessary).
  #
  # Example automation workflow:
  # - Add items to these lists, run `darwin-rebuild build --flake .#<host>` to
  #   preview, then `darwin-rebuild switch --flake .#<host>` to apply.

  homebrew = {
    # Homebrew taps (e.g., "dotenvx/brew")
    # taps need to be specified as strings (tap names).
    taps = [
      # "dotenvx/brew" # required for dotenvx formula
    ];

    # Homebrew formulae (non-GUI packages)
    # brews need to be specified as strings (formula names).
    brews = [
      # "git" # required for CLI workflows
    ];

    casks = [
      # Homebrew Casks should be specified as strings (Cask token names).
      # Add casks here, e.g.
      # "visual-studio-code" # editor - enable if you prefer cask-managed VSCode
    ];
  };
}
