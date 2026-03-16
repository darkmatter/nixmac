{ flake, ... }:
{
  imports = [
    flake.inputs.self.nixosModules.common
  ];

  services.openssh.enable = true;
}
