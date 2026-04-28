{ config, pkgs, ... }:

{
  # ============================================================
  # Services and Launchd Jobs Module
  # ============================================================
  #
  # Purpose:
  # - Centralized management of system services and launchd jobs.
  #
  # Key concepts:
  # - `services`: High-level modules (e.g., tailscale, skhd, yabai).
  # - `launchd.daemons`: System-wide (Root) jobs.
  # - `launchd.user.agents`: Per-user jobs (runs only when logged in).
  #
  # Note: StartCalendarInterval and similar keys are UpperCamelCase (Apple plist standard).
  #

  # ------------------------------------------------------------
  # High-level services
  # ------------------------------------------------------------
  services = {
    # Example: nix-darwin managed services
    # tailscale.enable = true;
    # yabai.enable = true;
  };

  # ------------------------------------------------------------
  # System-wide LaunchDaemons (runs as root)
  # ------------------------------------------------------------
  # launchd.daemons = {
  #   rebootSunday = {
  #     script = ''
  #       /sbin/shutdown -r now
  #     '';
  #     serviceConfig = {
  #       Label = "org.nix-darwin.rebootSunday";
  #       StartCalendarInterval = [
  #         { Weekday = 0; Hour = 3; Minute = 0; }
  #       ];
  #       RunAtLoad = false;
  #     };
  #   };
  # };

  # ------------------------------------------------------------
  # Per-user LaunchAgents (runs as ${USER})
  # ------------------------------------------------------------
  # launchd.user.agents = {
  #   # Example: User-level Nix garbage collection
  #   nix-gc-user = {
  #     serviceConfig = {
  #       Label = "org.nix-darwin.nix-gc-user";
  #       ProgramArguments = [
  #         "${pkgs.nix}/bin/nix-collect-garbage"
  #         "--delete-older-than"
  #         "30d"
  #       ];
  #       StartCalendarInterval = [
  #         { Hour = 10; Minute = 0; } # Daily at 10am
  #       ];
  #       RunAtLoad = true;
  #       StandardOutPath = "/tmp/nix-gc-user.out.log";
  #       StandardErrorPath = "/tmp/nix-gc-user.err.log";
  #     };
  #   };

  #   # Example: Running a custom shell script
  #   cleanup-logs = {
  #     script = ''
  #       find /Users/Shared/Logs -name "*.log" -mtime +7 -delete
  #     '';
  #     serviceConfig = {
  #       Label = "org.nix-darwin.cleanup-logs";
  #       StartCalendarInterval = [
  #         { Weekday = 6; Hour = 23; Minute = 59; }
  #       ];
  #     };
  #   };
  # };
}
