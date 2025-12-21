{
  pkgs,
  lib,
  config,
  ...
}: let 
  localPkgs = [
    pkgs.starship
  ];
in 
{
  # https://devenv.sh/basics/
  env.GREET = "devenv";

  # https://devenv.sh/packages/
  packages =
    [
      pkgs.sops
      pkgs.git
      pkgs.rustup
      pkgs.clippy
      pkgs.cargo-watch
      pkgs.cargo-nextest
      pkgs.libiconv
    ]
    ++ lib.optionals (builtins.getEnv "_PROFILE" == "development") localPkgs
    ++ lib.optionals pkgs.stdenv.isDarwin [
      pkgs.apple-sdk_15
    ];

  # languages.ruby.enable = true;
  # languages.ruby.bundler.enable = true;
  languages.swift.enable = true;
  # https://devenv.sh/languages/
  languages.rust.enable = true;
  languages.rust.channel = "stable";
  languages.javascript.enable = true;
  languages.javascript.bun.install.enable = true;
  languages.javascript.bun.enable = true;
  languages.typescript.enable = true;
  languages.nix.enable = true;

  # https://devenv.sh/processes/
  # processes.dev.exec = "${lib.getExe pkgs.watchexec} -n -- ls -la";
  processes.tauri = {
    cwd = "${config.git.root}/apps/native";
    exec = "${pkgs.sops}/bin/sops exec-env ${config.git.root}/.secrets.enc.yaml 'tauri dev'";
  };
  # processes.tauri-vite = {
  #   cwd = "${config.git.root}/apps/native";
  #   exec = "${pkgs.bun}/bin/bun run dev";
  # };
  processes.web = {
    cwd = "${config.git.root}/apps/web";
    exec = "${pkgs.bun}/bin/bun run dev";
  };
  processes.server = {
    cwd = "${config.git.root}/apps/server";
    exec = "${pkgs.bun}/bin/bun run dev";
  };
  processes.storybook = {
    cwd = "${config.git.root}/apps/native";
    exec = "${pkgs.bun}/bin/bun run storybook";
    process-compose = {
      is_foreground = true;
      disabled = true;
    };
  };
  processes.test = {
    cwd = "${config.git.root}/apps/native";
    exec = "sops exec-env ${config.git.root}/.secrets.enc.yaml 'bun run test:watch'";
  };

  # https://devenv.sh/services/
  # services.postgres = {
  #   enable = true;
  #   package = pkgs.postgresql_17;
  #   initialDatabases = [{ name = "nixmac"; }];
  # };


  # https://devenv.sh/basics/
  enterShell = ''
    echo "$(starship preset pure-preset)" > $DEVENV_STATE/starship.toml
    export STARSHIP_CONFIG=$DEVENV_STATE/starship.toml
    eval "$(starship init $SHELL)"
  '';

  # https://devenv.sh/tasks/
  # tasks = {
  #   "myproj:setup".exec = "mytool build";
  #   "devenv:enterShell".after = [ "myproj:setup" ];
  # };

  # https://devenv.sh/tests/
  enterTest = ''
    echo "Running tests"
    git --version | grep --color=auto "${pkgs.git.version}"
  '';

  treefmt.enable = true;
  # type: nixpkgs.devenv
  treefmt.config.programs.rustfmt.enable = true;
  # treefmt.config.programs.clippy.enable = true;
  treefmt.config.programs.biome.enable = true;
  treefmt.config.programs.yamlfmt.enable = true;
  treefmt.config.programs.mdformat.enable = true;

  # https://devenv.sh/git-hooks/
  git-hooks.hooks.biome.enable = true;
  git-hooks.hooks.shellcheck.enable = true;
  git-hooks.hooks.rustfmt.enable = true;
  git-hooks.hooks.clippy.enable = true;
  git-hooks.hooks.mdformat.enable = true;
  git-hooks.excludes = [
    "^.*\/?(\.git|\.direnv|\.devenv|\.vscode|\.idea|\.DS_Store|\.env|\.envrc).*$"
  ];

  # See full reference at https://devenv.sh/reference/options/
  profiles = {
    development = {
      env._PROFILE = "development";
    };
    production = {
      env._PROFILE = "production";
    };
  };
}
