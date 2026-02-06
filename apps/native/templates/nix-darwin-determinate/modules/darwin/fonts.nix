{ config, pkgs, ... }:

{
  # Fonts module
  # Purpose:
  # - Install fonts available from nixpkgs into the system so GUI applications
  #   and terminal environments can use them.
  #
  # Usage notes:
  # - Add fonts using `with pkgs; [ ... ]` and include a short comment for
  #   each font explaining why it's included (e.g. "programming font").
  # - On macOS, font caches may need rebuilding after changes; document any
  #   manual steps here if required by other tooling.
  #
  fonts.packages = with pkgs; [
    # Example fonts (uncomment to enable):
    # noto-fonts  # general multilingual font family
    # fira-code   # programming font with ligatures
  ];

  # Document any macOS-specific font handling or pitfalls here for future
  # automation. For example, if a font must be installed via Homebrew cask
  # instead of nixpkgs, note that here and why.
}
