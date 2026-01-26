{ lib, pkgs, ... }:

{
  # Nixpkgs overlays
  # Purpose:
  # - Provide a central place to define overlays that modify or extend
  #   packages from `nixpkgs` for this machine.
  #
  # Usage notes:
  # - Each overlay has the form: `self: super: { <pkg> = ...; }`.
  # - Overlays are useful for:
  #   - Patching a package with local fixes
  #   - Adding a custom package built from a local directory
  #   - Adjusting package defaults for the system
  #
  # Example overlay (commented):
  # (self: super: {
  #   myCustomGit = super.callPackage ./packages/my-git { };
  # })
  
  nixpkgs.overlays = [
    # Add overlays here
  ];
}
