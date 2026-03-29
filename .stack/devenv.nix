# ==============================================================================
# devenv.nix
#
# Devenv configuration for this project.
# These are standard devenv options (packages, languages, env, etc.)
#
# Documentation: https://devenv.sh/reference/options/
# ==============================================================================
{
  pkgs,
  lib,
  inputs,
  ...
}:
{
  # ---------------------------------------------------------------------------
  # Packages - Available in the dev shell
  # ---------------------------------------------------------------------------
  packages = with pkgs; [
    git
    jq
    # Add your packages here
  ];

  # ---------------------------------------------------------------------------
  # Languages - Enable language toolchains
  # ---------------------------------------------------------------------------
  languages = {
    # javascript = {
    #   enable = true;
    #   bun.enable = true;
    #   bun.install.enable = true;
    # };

    # typescript.enable = true;

    # go.enable = true;

    # python = {
    #   enable = true;
    #   version = "3.12";
    # };

    # rust.enable = true;
  };

  # ---------------------------------------------------------------------------
  # Environment Variables
  # ---------------------------------------------------------------------------
  env = {
    # DATABASE_URL = "postgres://localhost:5432/myapp";
    # NODE_ENV = "development";
  };

  # ---------------------------------------------------------------------------
  # Shell Hook - Runs when entering the shell
  # ---------------------------------------------------------------------------
  enterShell = ''
    echo "Welcome to the dev environment!"
  '';

  # ---------------------------------------------------------------------------
  # Processes - Run with `devenv up`
  # ---------------------------------------------------------------------------
  # processes = {
  #   server.exec = "bun run dev";
  #   worker.exec = "bun run worker";
  # };

  # ---------------------------------------------------------------------------
  # Services - Managed services (postgres, redis, etc.)
  # ---------------------------------------------------------------------------
  # services.postgres = {
  #   enable = true;
  #   initialDatabases = [{ name = "myapp"; }];
  # };

  # services.redis.enable = true;

  # ---------------------------------------------------------------------------
  # Scripts - Custom commands available in the shell
  # ---------------------------------------------------------------------------
  # scripts.dev.exec = "bun run dev";
  # scripts.build.exec = "bun run build";
}
