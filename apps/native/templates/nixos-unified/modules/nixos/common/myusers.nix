{ flake, pkgs, lib, config, ... }:
let
  inherit (flake.inputs) self;
  mapListToAttrs = users: f:
    lib.listToAttrs (map (name: { inherit name; value = f name; }) users);
in
{
  options = {
    myusers = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      description = "List of usernames that get home-manager profiles";
      default =
        let
          dirContents = builtins.readDir (self + /configurations/home);
          fileNames = builtins.attrNames dirContents;
          regularFiles = builtins.filter (name: dirContents.${name} == "regular") fileNames;
          baseNames = map (name: builtins.replaceStrings [ ".nix" ] [ "" ] name) regularFiles;
        in
        baseNames;
    };
  };

  config = {
    users.users = mapListToAttrs config.myusers (name:
      lib.optionalAttrs pkgs.stdenv.isDarwin {
        home = "/Users/${name}";
      } // lib.optionalAttrs pkgs.stdenv.isLinux {
        isNormalUser = true;
      }
    );

    home-manager.users = mapListToAttrs config.myusers (name: {
      imports = [ (self + /configurations/home/${name}.nix) ];
    });

    nix.settings.trusted-users = [
      "root"
    ] ++ config.myusers;
  };
}
