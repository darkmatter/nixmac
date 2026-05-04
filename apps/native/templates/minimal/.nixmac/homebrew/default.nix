{ lib, ... }:

let
  data = builtins.fromJSON (builtins.readFile ./data.json);
in
{
  homebrew = {
    enable = lib.mkDefault true;
    taps = data.taps or [ ];
    brews = data.brews or [ ];
    casks = data.casks or [ ];
  }
  // lib.optionalAttrs (data ? onActivation) {
    onActivation = data.onActivation;
  };
}
