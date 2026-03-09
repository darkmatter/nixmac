{ ... }:
{
  programs.bash.enable = true;

  programs.zsh = {
    enable = true;
    autosuggestion.enable = true;
    syntaxHighlighting.enable = true;
    enableCompletion = true;
  };

  programs.starship = {
    enable = true;
    settings = {
      hostname.ssh_only = false;
      username.show_always = true;
    };
  };
}
