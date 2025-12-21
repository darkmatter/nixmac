# Karabiner-Elements configuration
# Config is COPIED (not symlinked) via files.nix because Karabiner needs write access
{ config, pkgs, lib, ... }:

{
  # Karabiner config is managed in files.nix using home.activation
  # This allows Karabiner to modify its own config file

  # If you want to fully reset to your Nix config, delete ~/.config/karabiner
  # and rebuild: rm -rf ~/.config/karabiner && darwin-rebuild switch
}
