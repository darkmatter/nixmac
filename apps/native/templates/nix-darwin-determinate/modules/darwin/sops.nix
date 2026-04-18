{ config, ... }:

let
  userHome = "/Users/${config.system.primaryUser}";
  envAgeKeyFile = builtins.getEnv "SOPS_AGE_KEY_FILE";
  macosAgeKeyFile = "${userHome}/Library/Application Support/sops/age/keys.txt";
  homeConfigAgeKeyFile = "${userHome}/.config/sops/age/keys.txt";
in

{
  # Base sops-nix setup only. Keep this module minimal so secret declarations
  # can be managed separately in `sops-secrets.nix`.
  sops = {
    defaultSopsFormat = "yaml";

    age = {
      keyFile =
        if envAgeKeyFile != "" && builtins.pathExists envAgeKeyFile then
          envAgeKeyFile
        else if builtins.pathExists macosAgeKeyFile then
          macosAgeKeyFile
        else if builtins.pathExists homeConfigAgeKeyFile then
          homeConfigAgeKeyFile
        else
          null;
    };
  };
}
