# Alacritty terminal configuration
{ config, pkgs, lib, ... }:

{
  programs.alacritty = {
    enable = true;

    settings = {
      window = {
        padding = { x = 10; y = 10; };
        decorations = "buttonless";
        opacity = 0.95;
        dynamic_title = true;
      };

      font = {
        size = 14.0;
        normal = { family = "JetBrainsMono Nerd Font"; style = "Regular"; };
        bold = { family = "JetBrainsMono Nerd Font"; style = "Bold"; };
        italic = { family = "JetBrainsMono Nerd Font"; style = "Italic"; };
        bold_italic = { family = "JetBrainsMono Nerd Font"; style = "Bold Italic"; };
      };

      cursor.style = { shape = "Block"; blinking = "Off"; };

      shell = {
        program = "${pkgs.zsh}/bin/zsh";
        args = [ "-l" ];
      };

      keyboard.bindings = [
        { key = "K"; mods = "Command"; action = "ClearHistory"; }
        { key = "V"; mods = "Command"; action = "Paste"; }
        { key = "C"; mods = "Command"; action = "Copy"; }
        { key = "Q"; mods = "Command"; action = "Quit"; }
        { key = "W"; mods = "Command"; action = "Quit"; }
        { key = "N"; mods = "Command"; action = "SpawnNewInstance"; }
        { key = "F"; mods = "Command|Control"; action = "ToggleFullscreen"; }
        { key = "Plus"; mods = "Command"; action = "IncreaseFontSize"; }
        { key = "Minus"; mods = "Command"; action = "DecreaseFontSize"; }
        { key = "Key0"; mods = "Command"; action = "ResetFontSize"; }
      ];

      scrolling = { history = 10000; multiplier = 3; };
      selection = { save_to_clipboard = true; semantic_escape_chars = '',│`|:"' ()[]{}<>\t''; };
      mouse = { hide_when_typing = true; };
    };
  };
}

