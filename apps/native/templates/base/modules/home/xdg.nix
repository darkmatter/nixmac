# XDG Base Directory configuration
{
  config,
  lib,
  pkgs,
  ...
}:

{
  xdg = {
    enable = true;

    # These work on macOS - they just set environment variables
    # and create the directories if needed
    cacheHome = "${config.home.homeDirectory}/.cache";
    configHome = "${config.home.homeDirectory}/.config";
    dataHome = "${config.home.homeDirectory}/.local/share";
    stateHome = "${config.home.homeDirectory}/.local/state";

    # NOTE: xdg.userDirs is Linux-only!
    # It configures Desktop/Documents/Downloads/etc via user-dirs.dirs
    # On macOS, these are managed by the system (~/Desktop, ~/Documents, etc.)
    # userDirs = { ... };  # Don't use on macOS
  };
}
