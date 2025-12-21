# Git configuration
{ config, pkgs, lib, user, ... }:

{
  programs.git = {
    enable = true;

    signing = {
      signByDefault = true;
      key = user.gitKey;
    };

    settings = {
      user = {
        name = user.fullName;
        email = user.email;
      };

      init.defaultBranch = "main";
      init.templatedir = "~/.git_template";

      core = {
        autocrlf = "input";
        editor = "vim";
        excludesfile = "${config.xdg.configHome}/git/ignore";
      };

      color.ui = "auto";
      diff = { colorMoved = "zebra"; tool = "vimdiff"; };
      merge = { ff = false; tool = "sublimerge"; };
      push.default = "current";
      pull.rebase = false;
      fetch.prune = true;
      rebase.autosquash = true;
      commit.template = "${config.xdg.configHome}/git/message";

      gpg = {
        format = "ssh";
        ssh.program = "/Applications/1Password.app/Contents/MacOS/op-ssh-sign";
      };

      filter.lfs = {
        clean = "git-lfs clean -- %f";
        process = "git-lfs filter-process";
        required = true;
        smudge = "git-lfs smudge -- %f";
      };

      alias = {
        aa = "add --all";
        ap = "add --patch";
        ci = "commit -v";
        co = "checkout";
        pf = "push --force-with-lease";
        st = "status";
        br = "branch";
        branches = "for-each-ref --sort=-committerdate --format='%(color:blue)%(authordate:relative)\t%(color:red)%(authorname)\t%(color:white)%(color:bold)%(refname:short)' refs/remotes";
        recent = "branch --sort=-committerdate --format='%(committerdate:relative)%09%(refname:short)'";
        lg = "log --graph --pretty=format:'%Cred%h%Creset -%C(yellow)%d%Creset %s %Cgreen(%cr) %C(bold blue)<%an>%Creset' --abbrev-commit";
        ll = "log --pretty=format:'%Cred%h%Creset -%C(yellow)%d%Creset %s %Cgreen(%cr) %C(bold blue)<%an>%Creset' --abbrev-commit --numstat";
        up = "!git pull --rebase --prune $@ && git submodule update --init --recursive";
        undo = "reset HEAD~1 --mixed";
        amend = "commit -a --amend";
        current-branch = "rev-parse --abbrev-ref HEAD";
        cleanup = "!git branch --merged | grep -v '\\*' | xargs -n 1 git branch -d";
      };
    };
  };

  programs.delta = {
    enable = true;
    enableGitIntegration = true;
    options = {
      navigate = true;
      line-numbers = true;
      decorations = {
        commit-decoration-style = "bold yellow box ul";
        file-style = "bold yellow ul";
        file-decoration-style = "none";
      };
    };
  };

  programs.git.ignores = [
    ".DS_Store" "._*" ".Spotlight-V100" ".Trashes"
    "*.swp" "*.swo" "*~" ".netrwhist"
    ".vscode/" "*.code-workspace" ".history/"
    ".direnv/" ".envrc"
    "node_modules/" "npm-debug.log*" "yarn-debug.log*" "yarn-error.log*" ".pnpm-debug.log*"
    "__pycache__/" "*.py[cod]" "*$py.class" ".Python" "venv/" ".venv/"
    ".terraform/" "*.tfstate" "*.tfstate.*"
    "*.log" ".env" ".env.local" ".env.*.local"
    ".aws-sam/"
  ];

  xdg.configFile."git/message".text = ''


    # 50-character subject line
    #
    # 72-character wrapped longer description. This should answer:
    #
    # * Why was this change necessary?
    # * How does it address the problem?
    # * Are there any side effects?
  '';
}

