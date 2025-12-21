# Mac Studio - Darwin system configuration
{ config, pkgs, lib, inputs, hostname, user, ... }:

{
  # Machine-specific network settings
  networking = {
    hostName = "coopers-mac-pro";
    computerName = "mac-pro";
    localHostName = "mac-pro";
  };

  # Machine-specific system defaults (uses common defaults, override here if needed)
  # system.defaults = { };

  # Machine-specific packages
  environment.systemPackages = [
    # Add Mac Studio-specific packages here
  ];
}
