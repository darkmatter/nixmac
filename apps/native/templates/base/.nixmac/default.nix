# Nixmac official modules. Agents may edit data.json files under this tree,
# but must not edit Nix implementation files here.
{ lib, ... }:

let
  entries = builtins.readDir ./.;
  moduleNames = lib.attrNames (
    lib.filterAttrs (
      name: type: type == "directory" && builtins.pathExists (./. + "/${name}/default.nix")
    ) entries
  );
in
{
  imports = map (name: ./. + "/${name}") moduleNames;
}
