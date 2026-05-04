{
  config,
  lib,
  pkgs,
  ...
}:

let
  data = builtins.fromJSON (builtins.readFile ./data.json);
  cfg = config.nixmac.ssh.fullDiskAccess;
  checkSshFda = pkgs.writeShellScript "check-ssh-fda" ''
    if [ -n "$SSH_CONNECTION" ] || [ -n "$SSH_CLIENT" ] || [ -n "$SSH_TTY" ]; then
      if ! test -r "/Library/Application Support/com.apple.TCC/TCC.db" 2>/dev/null; then
        echo ""
        echo "WARNING: SSH session detected without Full Disk Access"
        echo "darwin-rebuild may fail when updating apps over SSH without FDA."
        echo "Enable 'Allow full disk access for remote users' in System Settings > General > Sharing > Remote Login."
        echo "Alternatively, run darwin-rebuild in a local graphical terminal."
        echo ""
        ${lib.optionalString cfg.strict ''
          exit 1
        ''}
      fi
    fi
  '';
in
{
  options.nixmac.ssh.fullDiskAccess = {
    check = lib.mkEnableOption "startup check for SSH Full Disk Access" // {
      default = true;
    };

    strict = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Abort activation when running over SSH without Full Disk Access.";
    };
  };

  config = lib.mkMerge [
    {
      nixmac.ssh.fullDiskAccess = {
        check = data.check or true;
        strict = data.strict or false;
      };
    }
    (lib.mkIf cfg.check {
      system.activationScripts.preActivation.text = lib.mkBefore ''
        ${checkSshFda}
      '';
    })
  ];
}
