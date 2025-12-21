# Starship prompt configuration
{ lib, ... }:

{
  programs.starship = {
    enable = true;
    enableZshIntegration = true;

    settings = {
      add_newline = false;
      format = lib.concatStrings [
        "[░▒▓](#a3aed2)"
        "[  ](bg:#a3aed2 fg:#090c0c)"
        "[](bg:#568fa0 fg:#a3aed2)"
        "''$directory"
        "[](fg:#568fa0 bg:#394260)"
        "$git_branch"
        "$git_metrics"
        "[](fg:#394260 bg:#212736)"
        "$nix_shell"
        "[ ](fg:#1d2230)"
        "\n$character"
      ];
      right_format = "$time";

      username = {
        show_always = false;
        style_user = "bg:blue fg:black";
        style_root = "bg:blue fg:red bold";
        format = "[$user]($style)";
      };

      hostname = {
        ssh_only = true;
        format = "[@$hostname]($style) ";
        style = "bold green";
      };

      directory = {
        style = "fg:#0f172a bg:#0e0e15";
        repo_root_style = "fg:#4be4b5 bg:#515670";
        format = "[](fg:#8e93b0)[$path]($style)[$read_only]($read_only_style)";
        read_only = " ";
        read_only_style = "fg:#fde68a bg:#515670";
        truncation_length = 3;
        truncate_to_repo = true;
      };

      character = {
        success_symbol = "[❯](fg:#22c55e)";
        error_symbol = "[❯](fg:#ef4444)";
        vicmd_symbol = "[❮](fg:#22c55e)";
      };

      git_branch = {
        symbol = "";
        style = "fg:#73bf9c bg:#16a34a";
        format = "[](fg:#515670 bg:#16a34a)[ $branch ]($style)";
      };

      git_status = {
        format = "[](fg:#4be4b5 bg:#515670)[ $ahead_behind$staged$modified$untracked$stashed$deleted$conflicted$renamed ]($style)[](fg:#f97316)";
        style = "fg:#4be4b5 bg:#515670";
        conflicted = "✖$count ";
        up_to_date = "";
        untracked = "?$count ";
        stashed = "≡$count ";
        modified = "!$count ";
        staged = "+$count ";
        renamed = "»$count ";
        deleted = "✘$count ";
        ahead = "↑$count ";
        behind = "↓$count ";
        diverged = "↕$ahead_count/$behind_count ";
      };

      nodejs = {
        symbol = " ";
        style = "bold green";
        format = "[$symbol($version )]($style)";
      };
      golang = {
        symbol = " ";
        style = "bold cyan";
        format = "[$symbol($version )]($style)";
      };
      python = {
        symbol = " ";
        style = "yellow bold";
        format = "[$symbol($pyenv_prefix)($version )(\\($virtualenv\\) )]($style)";
      };
      rust = {
        symbol = " ";
        style = "bold red";
        format = "[$symbol($version )]($style)";
      };
      docker_context = {
        symbol = " ";
        style = "blue bold";
        format = "[$symbol$context]($style) ";
        only_with_files = true;
      };
      aws = {
        symbol = "  ";
        style = "bold orange";
        format = "[$symbol($profile )(\\($region\\) )]($style)";
        disabled = false;
      };
      cmd_duration = {
        min_time = 2000;
        format = "⏱ [$duration](bold yellow)";
      };
      line_break = {
        disabled = true;
      };

      battery = {
        full_symbol = "🔋 ";
        charging_symbol = "⚡️ ";
        discharging_symbol = "💀 ";
        display = [
          {
            threshold = 10;
            style = "bold red";
          }
          {
            threshold = 30;
            style = "bold yellow";
          }
        ];
      };

      time = {
        disabled = false;
        format = "[](fg:#4c566a)[$time](fg:#e5e9f0 bg:#4c566a)[](fg:#4c566a)";
        time_format = "%T";
      };
    };
  };

  programs.zsh.initContent = lib.mkBefore ''
    if command -v starship &> /dev/null; then
      export POWERLEVEL9K_DISABLE_CONFIGURATION_WIZARD=true
    fi
  '';
}
