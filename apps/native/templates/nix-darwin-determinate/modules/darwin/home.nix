{ ... }:

{
  # Configure Home Manager through nix-darwin.
  # Uncomment these lines to enable Home Manager and configure it
  # for the primary user.
  # NOTE: First you must enable the home-manager input in flake.nix and add the
  # darwin module to the configuration modules list.

  # home-manager = {
  #   useGlobalPkgs = true;
  #   useUserPackages = true;

  #   users.USERNAME_PLACEHOLDER = {
  #     home.stateVersion = "24.05";

  #     # Let Home Manager manage itself.
  #     programs.home-manager.enable = true;
  #   };
  # };
}
