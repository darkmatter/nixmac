# Flake-parts modules - aggregates all flake-level configuration
{
  imports = [
    ./darwin.nix
    ./home.nix
    ./packages.nix
    ./dev-shells.nix
  ];
}

