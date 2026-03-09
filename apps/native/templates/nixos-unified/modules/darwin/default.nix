{ flake, ... }:
{
  imports = [
    flake.inputs.self.nixosModules.common
  ];

  security.pam.services.sudo_local.touchIdAuth = true;

  system.defaults = {
    finder = {
      AppleShowAllExtensions = true;
      ShowPathbar = true;
      ShowStatusBar = true;
    };
  };
}
