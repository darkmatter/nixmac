{ config, ... }:
{
  programs.git = {
    enable = true;
    userName = config.me.fullname;
    userEmail = config.me.email;
    ignores = [ "*~" "*.swp" ];
  };
}
