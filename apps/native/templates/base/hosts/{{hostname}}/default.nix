# Generated Darwin system configuration
{ ... }:

{
  # Machine-specific network settings
  networking = {
    hostName = "HOSTNAME_PLACEHOLDER";
    computerName = "HOSTNAME_PLACEHOLDER";
    localHostName = "HOSTNAME_PLACEHOLDER";
  };

  # Machine-specific system defaults (uses common defaults, override here if needed)
  # system.defaults = { };

  # Machine-specific packages
  environment.systemPackages = [
    # Add Mac Studio-specific packages here
  ];
}
