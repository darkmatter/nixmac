# MacBook Pro - Darwin system configuration
{ config, pkgs, lib, inputs, hostname, user, ... }:

{
  # Machine-specific network settings
  networking = {
    hostName = "Coopers-MacBook-Pro";
    computerName = "Cooper's MacBook Pro";
    localHostName = "Coopers-MacBook-Pro";
  };

  # Machine-specific system defaults
  system.defaults = {
    dock = {
      autohide = true;
      largesize = 64;
      magnification = true;
      minimize-to-application = true;
      mru-spaces = false;
      show-recents = false;
      tilesize = 48;
    };

    finder = {
      AppleShowAllExtensions = true;
      FXEnableExtensionChangeWarning = false;
      FXPreferredViewStyle = "clmv";
      ShowPathbar = true;
      ShowStatusBar = true;
      _FXSortFoldersFirst = true;
    };

    NSGlobalDomain = {
      AppleInterfaceStyle = "Dark";
      AppleShowAllExtensions = true;
      InitialKeyRepeat = 15;
      KeyRepeat = 2;
      NSAutomaticCapitalizationEnabled = false;
      NSAutomaticDashSubstitutionEnabled = false;
      NSAutomaticPeriodSubstitutionEnabled = false;
      NSAutomaticQuoteSubstitutionEnabled = false;
      NSAutomaticSpellingCorrectionEnabled = false;
      "com.apple.keyboard.fnState" = true;
      "com.apple.trackpad.scaling" = 3.0;
    };

    trackpad = {
      Clicking = true;
      TrackpadRightClick = true;
      TrackpadThreeFingerDrag = true;
    };
  };

  # Machine-specific packages (if any)
  environment.systemPackages = [
    # Add MacBook-specific packages here
  ];
}
