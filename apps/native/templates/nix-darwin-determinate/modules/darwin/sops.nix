{ config, ... }:

{
  # Base sops-nix setup only. Keep this module minimal so secret declarations
  # can be managed separately in `sops-secrets.nix`.
  sops = {
    defaultSopsFormat = "yaml";

    age = {
      keyFile = "/Users/${config.system.primaryUser}/.config/sops/age/keys.txt";
    };
  };
}
