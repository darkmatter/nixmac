# macOS system defaults and preferences
{ config, pkgs, lib, ... }:

{
  system.defaults = {
    # Dock
    dock = {
      autohide = true;
      minimize-to-application = true;
      show-recents = false;
      tilesize = 48;
      largesize = 64;
      magnification = true;
      show-process-indicators = true;
      launchanim = true;
      showhidden = false;
      mru-spaces = false;
      expose-animation-duration = 0.1;
    };

    # Finder
    finder = {
      AppleShowAllExtensions = true;
      ShowPathbar = true;
      ShowStatusBar = true;
      FXEnableExtensionChangeWarning = false;
      FXPreferredViewStyle = "clmv";
      _FXSortFoldersFirst = true;
      AppleShowAllFiles = false;
      QuitMenuItem = false;
      FXDefaultSearchScope = "SCsp";
      _FXShowPosixPathInTitle = false;
      CreateDesktop = true;
    };

    # Trackpad
    trackpad = {
      Clicking = true;
      TrackpadRightClick = true;
      TrackpadThreeFingerDrag = true;
      FirstClickThreshold = 1;
      SecondClickThreshold = 1;
      ActuateDetents = true;
    };

    # Screenshots
    screencapture = {
      location = "~/Downloads";
      type = "png";
      disable-shadow = false;
      show-thumbnail = true;
    };

    # Login Window
    loginwindow = {
      GuestEnabled = false;
      SHOWFULLNAME = false;
      autoLoginUser = null;
      LoginwindowText = null;
      PowerOffDisabledWhileLoggedIn = false;
      RestartDisabledWhileLoggedIn = false;
      ShutDownDisabledWhileLoggedIn = false;
    };

    # Menu Bar Clock
    menuExtraClock = {
      ShowDate = 0;
      ShowDayOfWeek = true;
      Show24Hour = false;
      ShowSeconds = false;
      FlashDateSeparators = false;
      IsAnalog = false;
    };

    # Activity Monitor
    ActivityMonitor = {
      ShowCategory = 100;
      SortColumn = "CPUUsage";
      SortDirection = 0;
      IconType = 5;
      OpenMainWindow = true;
    };

    # Spaces
    spaces = {
      spans-displays = true;
    };

    # Screen Saver
    screensaver = {
      askForPassword = true;
      askForPasswordDelay = 5;
    };

    # SMB
    smb = {
      NetBIOSName = null;
      ServerDescription = null;
    };

    # Global macOS Settings
    NSGlobalDomain = {
      # Dark mode
      AppleInterfaceStyle = "Dark";
      AppleShowAllExtensions = true;
      AppleShowScrollBars = "WhenScrolling";

      # Keyboard
      NSAutomaticCapitalizationEnabled = false;
      NSAutomaticSpellingCorrectionEnabled = false;
      NSAutomaticPeriodSubstitutionEnabled = false;
      NSAutomaticQuoteSubstitutionEnabled = false;
      NSAutomaticDashSubstitutionEnabled = false;
      ApplePressAndHoldEnabled = false;
      KeyRepeat = 2;
      InitialKeyRepeat = lib.mkDefault 10;
      NSWindowResizeTime = 0.001;

      # Save & Print Panels
      NSNavPanelExpandedStateForSaveMode = true;
      NSNavPanelExpandedStateForSaveMode2 = true;
      PMPrintingExpandedStateForPrint = true;
      PMPrintingExpandedStateForPrint2 = true;
      NSDocumentSaveNewDocumentsToCloud = false;

      # Text & Editing
      NSTextShowsControlCharacters = false;
      NSUseAnimatedFocusRing = true;

      # Measurements & Units
      AppleMeasurementUnits = "Centimeters";
      AppleMetricUnits = 1;
      AppleTemperatureUnit = "Celsius";

      # Sound
      "com.apple.sound.beep.volume" = 0.5;
      "com.apple.sound.beep.feedback" = 0;

      # Sidebar icon size
      NSTableViewDefaultSizeMode = 2;
    };

    # Custom User Preferences
    CustomUserPreferences = {
      "com.apple.TimeMachine" = {
        DoNotOfferNewDisksForBackup = true;
      };

      "com.apple.frameworks.diskimages" = {
        skip-verify = true;
        skip-verify-locked = true;
        skip-verify-remote = true;
      };

      "com.apple.TextEdit" = {
        RichText = 0;
      };

      # Disable Spotlight (using Raycast)
      "com.apple.spotlight" = {
        orderedItems = [
          { enabled = 0; name = "APPLICATIONS"; }
          { enabled = 0; name = "MENU_SPOTLIGHT_SUGGESTIONS"; }
          { enabled = 0; name = "MENU_CONVERSION"; }
          { enabled = 0; name = "MENU_EXPRESSION"; }
          { enabled = 0; name = "MENU_DEFINITION"; }
          { enabled = 0; name = "SYSTEM_PREFS"; }
          { enabled = 0; name = "DOCUMENTS"; }
          { enabled = 0; name = "DIRECTORIES"; }
          { enabled = 0; name = "PRESENTATIONS"; }
          { enabled = 0; name = "SPREADSHEETS"; }
          { enabled = 0; name = "PDF"; }
          { enabled = 0; name = "MESSAGES"; }
          { enabled = 0; name = "CONTACT"; }
          { enabled = 0; name = "EVENT_TODO"; }
          { enabled = 0; name = "IMAGES"; }
          { enabled = 0; name = "BOOKMARKS"; }
          { enabled = 0; name = "MUSIC"; }
          { enabled = 0; name = "MOVIES"; }
          { enabled = 0; name = "FONTS"; }
          { enabled = 0; name = "MENU_OTHER"; }
        ];
      };

      "com.raycast.macos" = {
        showInMenuBar = true;
        initialSpotlightSetupCompleted = true;
        analyticsEnabled = false;
        crashReportingEnabled = false;
        emojiPickerSkinTone = 0;
        popToRootTimeout = 60;
        navigationCommandStyleIdentifierKey = "default";
        keepHistoryInClipboard = true;
        clipboardHistoryLength = 100;
        windowWidth = 680;
        "NSStatusItem Preferred Position Item-0" = 0.0;
        "raycast-telemetry" = false;
      };
    };
  };
}

