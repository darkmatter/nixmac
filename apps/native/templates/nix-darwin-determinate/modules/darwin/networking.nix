{ config, pkgs, ... }:

{
  # Networking module
  # Purpose:
  # - Centralize hostname, DNS/resolver settings, and any firewall rules or
  #   network-specific options for this machine.
  #
  # Notes for maintainers and automation:
  # - Keep sensitive network details (VPN credentials, private keys) out of
  #   this file; use a secrets mechanism or encrypted store and document how
  #   to inject them at runtime.
  # - If using PF (packet filter) rules, keep them documented and versioned
  #   here alongside examples.

  networking = {
    # Override the host name for the machine if needed:
    # hostName = "my-macbook";

    # Resolver / DNS settings example (uncomment to use):
    # nameservers = [ "1.1.1.1" "8.8.8.8" ];
  };

  # Example: central place to document network setup and any manual steps.
  # This makes it easier for an AI or human to understand required networking
  # state before applying other modules that depend on the network.
}
