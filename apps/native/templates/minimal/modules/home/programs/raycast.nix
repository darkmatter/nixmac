# Raycast configuration
# Config is COPIED (not symlinked) via files.nix because Raycast needs write access
{
  config,
  pkgs,
  lib,
  ...
}:

{
  # Raycast config is managed in files.nix using home.activation
  # This allows Raycast to modify its preferences

  # To reset to your Nix config:
  # rm ~/.config/raycast/preferences.json && darwin-rebuild switch
}
