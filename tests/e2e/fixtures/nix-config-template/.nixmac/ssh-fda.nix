# SSH Full Disk Access Check Module
#
# This module adds a startup check that detects when running over SSH without
# Full Disk Access enabled, and warns the user before darwin-rebuild fails.
#
# Without FDA enabled for SSH, you'll encounter the error:
#   "permission denied when trying to update apps over SSH, aborting activation"
#
# The check runs early in the activation process and provides clear instructions
# on how to resolve the issue.
{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.nixmac.ssh.fullDiskAccess;

  # Script to check if we're running over SSH and if FDA is available
  checkSshFda = pkgs.writeShellScript "check-ssh-fda" ''
    # Check if we're running over SSH
    if [ -n "$SSH_CONNECTION" ] || [ -n "$SSH_CLIENT" ] || [ -n "$SSH_TTY" ]; then
      # We're over SSH - check if we have FDA by testing access to a protected path
      # The TCC database requires FDA to read
      if ! test -r "/Library/Application Support/com.apple.TCC/TCC.db" 2>/dev/null; then
        echo ""
        echo "┌─────────────────────────────────────────────────────────────────────────────┐"
        echo "│  ⚠️  WARNING: SSH session detected without Full Disk Access                 │"
        echo "├─────────────────────────────────────────────────────────────────────────────┤"
        echo "│                                                                             │"
        echo "│  darwin-rebuild will fail when updating apps over SSH without FDA.          │"
        echo "│                                                                             │"
        echo "│  To fix this, enable 'Allow full disk access for remote users':             │"
        echo "│                                                                             │"
        echo "│    1. Open System Settings → General → Sharing                              │"
        echo "│    2. Find 'Remote Login' and click the ⓘ icon next to the toggle          │"
        echo "│    3. Enable 'Allow full disk access for remote users'                      │"
        echo "│                                                                             │"
        echo "│  Alternatively, run darwin-rebuild in a local graphical terminal.           │"
        echo "│                                                                             │"
        echo "└─────────────────────────────────────────────────────────────────────────────┘"
        echo ""

        # Exit with error if strict mode is enabled
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
      description = ''
        Whether to check for Full Disk Access when running over SSH.

        When enabled, the system will detect if you're running over SSH
        without Full Disk Access and display a warning with instructions
        on how to enable it.

        This check runs early in the activation process, before
        darwin-rebuild would otherwise fail with a cryptic error.
      '';
    };

    strict = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = ''
        Whether to abort activation if running over SSH without FDA.

        When enabled, the activation will fail early with a clear error
        message instead of proceeding and failing later during app updates.

        When disabled (default), a warning is shown but activation continues.
      '';
    };
  };

  config = lib.mkIf cfg.check {
    # Add the check as an early activation script
    system.activationScripts.preActivation.text = lib.mkBefore ''
      # Check for SSH Full Disk Access
      ${checkSshFda}
    '';
  };
}
