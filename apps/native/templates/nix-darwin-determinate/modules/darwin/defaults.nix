{ config, pkgs, ... }:

{
  # Defaults and macOS platform-specific opinionated settings
  # Purpose:
  # - Central place for small platform defaults consumed by other modules or
  #   by user-level dotfiles (e.g., Dock sizing, Finder defaults).
  # - Keep values idempotent and document rationale for non-obvious choices.
  #
  # Guidelines for AI automation:
  # - Prefer to set scalar keys inside `system.defaults.<namespace>` rather
  #   than editing arbitrary dotfiles directly.
  # - When creating nested attrsets (e.g., `system.defaults.dock`), include a
  #   short comment explaining intent.

  system.defaults = {
    # Example: Dock defaults (used by various helper tooling or migration
    # scripts). Agents should use `set_attrs` to create/update this block.
    # dock = {
    #   # Dock icon size (points)
    #   tilesize = 48;

    #   # Auto-hide the Dock by default
    #   autohide = true;
    # };
  };
}
