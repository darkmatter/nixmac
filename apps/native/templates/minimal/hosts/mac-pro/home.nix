# Mac Studio - Home Manager configuration
{ config, pkgs, lib, inputs, hostname, user, ... }:

{
  imports = [
    # Common home-manager modules
    ../../modules/home
  ];

  # Home Manager basic configuration
  home = {
    username = user.username;
    homeDirectory = lib.mkForce user.homeDirectory;
    stateVersion = "24.05";
  };

  # Let Home Manager manage itself
  programs.home-manager.enable = true;

  # Wallpaper configuration for multiple monitors
  home.file."Pictures/wallpaper.jpg".source = ./black-hole.png;

  # Set wallpapers on activation
  home.activation.setWallpaper = lib.hm.dag.entryAfter ["writeBoundary"] ''
    WALLPAPER="${config.home.homeDirectory}/Pictures/wallpaper.jpg"

    if [ ! -f "$WALLPAPER" ]; then
      echo "No wallpaper files found."
    else
      $DRY_RUN_CMD /usr/bin/osascript << EOF
        tell application "System Events"
          set desktopCount to count of desktops
          repeat with desktopNumber from 1 to desktopCount
            tell desktop desktopNumber
              if desktopNumber is 1 then
                if (do shell script "test -f '$WALLPAPER' && echo 'exists' || echo 'missing'") is "exists" then
                  set picture to "$WALLPAPER"
                end if
              else if desktopNumber is 2 then
                if (do shell script "test -f '$WALLPAPER' && echo 'exists' || echo 'missing'") is "exists" then
                  set picture to "$WALLPAPER"
                end if
              end if
            end tell
          end repeat
        end tell
EOF
      echo "Wallpapers configured for all displays"
    fi
  '';
}

