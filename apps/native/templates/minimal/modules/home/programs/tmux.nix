# Tmux configuration
{ config, pkgs, lib, ... }:

{
  programs.tmux = {
    enable = true;
    baseIndex = 1;
    clock24 = false;
    escapeTime = 500;
    historyLimit = 10000;
    keyMode = "vi";
    mouse = false;
    terminal = "screen-256color";
    prefix = "C-b";

    plugins = with pkgs.tmuxPlugins; [
      sensible
      yank
      pain-control
      {
        plugin = catppuccin;
        extraConfig = ''
          set -g @catppuccin_flavour 'mocha'
          set -g @catppuccin_window_tabs_enabled on
          set -g @catppuccin_date_time "%Y-%m-%d %H:%M"
        '';
      }
      {
        plugin = resurrect;
        extraConfig = ''
          set -g @resurrect-strategy-vim 'session'
          set -g @resurrect-capture-pane-contents 'on'
        '';
      }
      {
        plugin = continuum;
        extraConfig = ''
          set -g @continuum-restore 'on'
          set -g @continuum-boot 'on'
          set -g @continuum-save-interval '10'
        '';
      }
    ];

    extraConfig = ''
      set -g prefix2 C-s
      set -g focus-events on
      setw -g aggressive-resize off
      setw -g pane-base-index 1
      set -g status-position bottom
      set -g status-justify left
      setw -g mode-keys vi
      set -g status-keys vi

      # Vim navigation
      bind-key h select-pane -L
      bind-key j select-pane -D
      bind-key k select-pane -U
      bind-key l select-pane -R
      bind-key -r C-h select-window -t :-
      bind-key -r C-l select-window -t :+

      # Split panes
      bind | split-window -h
      bind - split-window -v
      unbind '"'
      unbind %

      bind r source-file ~/.config/tmux/tmux.conf \; display-message "Config reloaded..."

      # Copy mode
      bind-key -T copy-mode-vi 'v' send -X begin-selection
      bind-key -T copy-mode-vi 'y' send -X copy-selection-and-cancel
      bind-key -T copy-mode-vi 'Enter' send -X copy-selection-and-cancel

      ${lib.optionalString pkgs.stdenv.isDarwin ''
        set-option -g default-command "reattach-to-user-namespace -l ${pkgs.zsh}/bin/zsh"
        bind-key -T copy-mode-vi 'y' send -X copy-pipe-and-cancel "reattach-to-user-namespace pbcopy"
        bind-key -T copy-mode-vi 'Enter' send -X copy-pipe-and-cancel "reattach-to-user-namespace pbcopy"
        bind ] run "reattach-to-user-namespace pbpaste | tmux load-buffer - && tmux paste-buffer"
      ''}

      unbind-key C-z
      bind -r ^ last-window
      bind -r H resize-pane -L 5
      bind -r J resize-pane -D 5
      bind -r K resize-pane -U 5
      bind -r L resize-pane -R 5

      bind c new-window -c "#{pane_current_path}"
      bind '"' split-window -c "#{pane_current_path}"
      bind % split-window -h -c "#{pane_current_path}"

      setw -g monitor-activity on
      set -g visual-activity off
      set -g renumber-windows on
      set -g display-panes-time 2000
      set -g display-time 3000

      if-shell "[ -f ~/.tmux.conf.local ]" 'source ~/.tmux.conf.local'
    '';
  };

  xdg.configFile."tmux/.keep".text = "";
}

