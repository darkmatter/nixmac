{ config, pkgs, ... }:

{
  # Security module
  # Purpose:
  # - Centralize security-relevant settings such as SSH client/server
  #   configuration, sudo rules, and notes about key management.
  #
  # Recommendations:
  # - Keep secrets out of this repository. Reference secure stores and
  #   document how to provision secrets for automated runs.
  # - When enabling servers (sshd) or services that expose ports, document
  #   why they are needed and any firewall rules that should accompany them.

  # ============================================================================
  # Touch ID for sudo (ENABLED BY DEFAULT)
  # ============================================================================
  # This allows you to use Touch ID instead of typing your password for sudo
  # commands, including darwin-rebuild operations. This improves the user
  # experience significantly and is safe on macOS.
  #
  # To disable this feature, comment out or remove the line below:
  security.pam.enableSudoTouchIdAuth = true;

  # ============================================================================
  # Security examples and guidance (macOS / nix-darwin)
  # ============================================================================
  # - Keep secrets out of the repository; reference a secure store for
  #   credentials and private keys.
  #
  # Sudo (recommended): grant minimal sudo access to specific users. Adapt
  # the example below and enable only when you intend to manage sudo here.
  # Example (uncomment to enable):
  # security.sudo = { enable = true; users = [ "johnsmith" ]; };
  #
  # SSH server: prefer the system sshd (launchd) or a Homebrew-installed
  # OpenSSH managed via `brew services`. Do not rely on a `programs.ssh`
  # switch that isn't supported on macOS/nix-darwin.
  #
  # SSH key provisioning: place public keys in users' ~/.ssh/authorized_keys
  # via your provisioning tooling or secure copy mechanisms.
  #
  # Disk encryption: FileVault and full-disk encryption are managed by macOS;
  # document any manual steps required for automated provisioning.

  # Notes: Document how GPG keys, SSH keys, and macOS Keychain integration are
  # handled for automated provisioning. FileVault and full-disk encryption are
  # typically managed outside of Nix; document any manual steps required.
}
