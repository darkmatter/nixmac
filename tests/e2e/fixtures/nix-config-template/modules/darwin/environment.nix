{ config, pkgs, ... }:

{
  # Environment variables module
  # Purpose:
  # - Centralize environment variables that should be available to user
  #   sessions, GUI apps, and `launchd` services.
  # - Avoid scattering environment exports across multiple modules.
  #
  # How this works:
  # - `environment.variables` will be exported into the system environment
  #   and made visible to GUI login sessions and services managed by
  #   launchd. Use this for values like `LANG`, `EDITOR`, and common paths.
  #
  # Guidelines for automation / AI:
  # - Prefer simple string values. If a variable must be derived from the
  #   runtime environment, document the reason and provide fallback behavior.
  # - Avoid exporting secrets in plaintext. Use a secrets manager or disk
  #   protected store; document how to inject secrets if necessary.
  # - For sops-nix, export secret *file paths* (for example /run/secrets/...)
  #   rather than secret values.
  #
  # Examples:
  # - LANG = "en_US.UTF-8";
  # - EDITOR = "nvim";
  # - XDG_CONFIG_HOME = "/Users/johnsmith/.config";

  environment.variables = {
    # Set environment variables here. Keep comments documenting why each
    # variable is needed so automated tools can make safe changes.
    # Example placeholders (uncomment to use):
    # EDITOR = "vim";
    # LANG = "en_US.UTF-8";
    # GITHUB_TOKEN_FILE = "/run/secrets/github-token";
  };
}
