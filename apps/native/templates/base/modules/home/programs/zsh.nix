# Zsh shell configuration
{ config, pkgs, lib, ... }:

{
  programs.zsh = {
    enable = true;

    history = {
      size = 4096;
      save = 4096;
      path = "${config.home.homeDirectory}/.zhistory";
      ignoreDups = true;
      ignoreAllDups = true;
      ignoreSpace = true;
      extended = true;
      share = true;
    };

    autocd = true;
    defaultKeymap = "emacs";

    sessionVariables = {
      EDITOR = "nvim";
      VISUAL = "nvim";
      ERL_AFLAGS = "-kernel shell_history enabled";
    };

    shellAliases = {
      # Unix basics
      ls = "eza --color=always --group-directories-first --icons";
      ll = "ls -la";
      la = "ls -a";
      lt = "ls --tree --level=2";
      ln = "ln -v";
      mkdir = "mkdir -p";
      e = "$EDITOR";
      v = "$VISUAL";
      vi = "nvim";
      vim = "nvim";
      ce = "cursor editor .";

      # Navigation
      ".." = "cd ..";
      "..." = "cd ../..";
      "...." = "cd ../../..";
      "....." = "cd ../../../..";
      "-" = "cd -";
      dev = "cd ~/Developer";
      cdr = ''cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)"'';

      # Docker
      dcu = "docker compose up -d";
      dcd = "docker compose down";
      dockercpu = ''docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.NetIO}}\t{{.BlockIO}}' '';

      # Git aliases
      gst = "git status";
      ga = "git add";
      gaa = "git add --all";
      gc = "git commit";
      "gc!" = "git commit --amend";
      gco = "git checkout";
      gcb = "git checkout -b";
      gcp = "git cherry-pick";
      gd = "git diff";
      gf = "git fetch";
      gl = "git pull";
      gp = "git push";
      gr = "git remote";
      grb = "git rebase";
      grhh = "git reset HEAD --hard";
      glog = "git log --oneline --decorate --graph";
      gsb = "git status -sb";
      gsh = "git show";
      gss = "git status -s";

      # Utilities
      path = ''echo $PATH | tr -s ":" "\n"'';
      "alias?" = "alias | grep";
      reload = "source ~/.zshrc";
    };

    oh-my-zsh = {
      enable = true;
      plugins = [ "git" "docker" "aws" "colored-man-pages" "fzf" ];
      theme = "robbyrussell";
    };

    plugins = [
      {
        name = "zsh-syntax-highlighting";
        src = pkgs.fetchFromGitHub {
          owner = "zsh-users/zsh-syntax-highlighting";
          repo = "zsh-syntax-highlighting";
          rev = "0.7.1";
          sha256 = "03r6hpb5fy4yaakqm3lbf4xcvd408r44jgpv4lnzl9asp4sb9qc0";
        };
      }
      {
        name = "zsh-autosuggestions";
        src = pkgs.fetchFromGitHub {
          owner = "zsh-users/zsh-autosuggestions";
          repo = "zsh-autosuggestions";
          rev = "v0.7.0";
          sha256 = "0z6i9wjjklb4lvr7zjhbphibsyx51psv50gm07mbb0kj9058j6kc";
        };
      }
      {
        name = "powerlevel10k";
        src = pkgs.zsh-powerlevel10k;
        file = "share/zsh-powerlevel10k/powerlevel10k.zsh-theme";
      }
    ];

    initContent = ''
      # Powerlevel10k instant prompt
      if [[ -r "''${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-''${(%):-%n}.zsh" ]]; then
        source "''${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-''${(%):-%n}.zsh"
      fi

      [[ ! -f ~/.p10k.zsh ]] || source ~/.p10k.zsh

      # Load custom functions
      if [ -d "$HOME/.zsh/functions" ]; then
        for function in ~/.zsh/functions/*; do
          if [[ -f "$function" && ! "$function" =~ \.disabled$ ]]; then
            source "$function"
          fi
        done
      fi

      # Options
      setopt autocd autopushd pushdminus pushdsilent pushdtohome cdablevars
      DIRSTACKSIZE=5
      setopt extendedglob
      unsetopt nomatch
      setopt hist_ignore_all_dups inc_append_history

      # Keybindings
      bindkey -e
      bindkey '^r' history-incremental-search-backward
      bindkey '^[[A' up-line-or-search
      bindkey '^[[B' down-line-or-search

      # Directory colors
      export CLICOLOR=1
      export LSCOLORS=ExFxBxDxCxegedabagacad

      # FZF configuration
      if command -v fzf &> /dev/null; then
        export FZF_DEFAULT_COMMAND='fd --type f --hidden --follow --exclude .git'
        export FZF_DEFAULT_OPTS='
          --color=bg+:#313244,bg:#1e1e2e,spinner:#f5e0dc,hl:#f38ba8
          --color=fg:#cdd6f4,header:#f38ba8,info:#cba6f7,pointer:#f5e0dc
          --color=marker:#f5e0dc,fg+:#cdd6f4,prompt:#cba6f7,hl+:#f38ba8
        '
      fi

      # Auto-Warpify
      printf '\eP$f{"hook": "SourcedRcFileForWarp", "value": { "shell": "zsh"}}\x9c'

      [[ -f ~/.zshrc.local ]] && source ~/.zshrc.local
    '';

    enableCompletion = true;
    completionInit = ''
      zstyle ':completion:*' matcher-list 'm:{a-zA-Z}={A-Za-z}' 'r:|=*' 'l:|=* r:|=*'
      zstyle ':completion:*' list-colors ''${(s.:.)LS_COLORS}

      if [ -d "$HOME/.zsh/completion" ]; then
        fpath=($HOME/.zsh/completion $fpath)
      fi

      autoload -Uz compinit && compinit
    '';
  };
}

