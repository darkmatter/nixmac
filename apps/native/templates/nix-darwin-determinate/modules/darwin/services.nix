{ config, pkgs, ... }:

{
  # Services and launchd jobs module
  # Purpose:
  # - Enable or configure system services and `launchd` jobs in a central
  #   location so they can be reviewed and managed easily.
  #
  # Key concepts:
  # - `services` covers higher-level dtions provided by nixpkgs/nix-darwin
  #   (e.g. openssh, nginx when available).
  # - `launchd.systemJobs` and `launchd.userJobs` provide low-level control for
  #   macOS `launchd` jobs (system-wide or per-user respectively).
  #
  # Guidelines for AI automation:
  # - Prefer idempotent declarations (set `enable = true|false`).
  # - When creating `launchd` jobs, include `program` array, `runAtLoad` and
  #   `keepAlive` fields where appropriate and document expected behavior.
  #
  services = {
    # Example: enable OpenSSH server (macOS includes sshd; enable here only
    # if you want to manage it with Nix):
    # openssh = { enable = true; permitRootLogin = "no"; };

    # Add other service declarations provided by nixpkgs/nix-darwin below.
  };

  # Example `launchd` configuration (user-scoped):
  # launchd.userJobs = {
  #   myAgent = {
  #     program = [ "/usr/local/bin/some-agent" "--flag" ];
  #     runAtLoad = true;
  #     keepAlive = true;
  #     # document why this job exists and any required env vars
  #   };
  # };
}
