{ config, pkgs, ... }:

{
  # Users module
  # Purpose:
  # - Manage local user accounts, shells, and group membership.
  # - Keep sudo rules and user-specific settings centralized.
  #
  # Guidelines:
  # - Avoid changing the primary user in this file unless you fully intend
  #   to change the machine's primary account and home directory structure.
  # - When adding users, ensure `uid` does not collide with existing values.
  # - Prefer `isNormalUser = true` for regular human accounts; set secure
  #   shells and `extraGroups` as needed.
  #
  # Example automation notes for AI:
  # - If creating users programmatically, ensure you add a comment describing
  #   why the account exists and any required post-creation steps.
  # - Do not include plaintext passwords in the Nix configuration.
  #
  users.users = {
    # Example user (adjust uid/home/shell as needed):
    # alice = {
    #   isNormalUser = true;
    #   uid = 1001;
    #   home = "/Users/alice";
    #   shell = pkgs.zsh;
    #   extraGroups = [ "staff" "docker" ];
    # };
  };

  # Sudo configuration (nix-darwin exposes `security.sudo`):
  # Use this to grant sudo rights to specific users without editing /etc/sudoers
  # directly. Keep the list minimal and document why each user needs sudo.
  # Example (commented):
  # security.sudo = {
  #   enable = true;
  #   users = [ "johnsmith" ];
  # };
}
