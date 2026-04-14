{ pkgs, ... }:
{

  packages = [
    pkgs.bun
    # bun2nix CLI - use via: nix run github:nix-community/bun2nix
  ];

  # See full reference at https://devenv.sh/reference/options/
  profiles = {
    development.module = {
      env._PROFILE = "development";
    };
    production.module = {
      env._PROFILE = "production";
    };
  };
}
