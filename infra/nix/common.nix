{ pkgs, lib, config, ... }:
let
  # Minimal "web" container that serves everything from TanStack Start's Nitro output:
  # - SSR app + API routes (including /api/* and /trpc/* forwarded into Hono)
  # - Static assets
  #
  # NOTE: This expects you to build the web artifact before building the container:
  # - web: `cd apps/web && bun --bun run build` (produces ./apps/web/.output)
  #
  # If `apps/web/.output` doesn't exist, Nix eval will fail (because it is referenced as a path).
  # Optimized web bundle: only include server + public, exclude dev files
  webBundle = pkgs.runCommand "web" { } ''
    mkdir -p $out/.output
    cp -R ${./apps/web/.output}/server $out/.output/
    cp -R ${./apps/web/.output}/public $out/.output/
    # Remove source maps and TypeScript files (not needed at runtime)
    find $out -type f \( -name "*.map" -o -name "*.ts" -o -name "*.tsx" \) -delete 2>/dev/null || true
  '';
in
{


  # See full reference at https://devenv.sh/reference/options/
  profiles = {
    development = {
      env._PROFILE = "development";
    };
    production = {
      env._PROFILE = "production";
    };
  };
}


