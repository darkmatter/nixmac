{
  pkgs,
  lib,
  config,
  ...
}:
lib.mkIf (!(config.container.isBuilding or false)) {
  # Dev-only packages (excluded from container builds by conditional import).
  packages = [
    pkgs.rustup
    pkgs.clippy
    pkgs.cargo-watch
    pkgs.cargo-nextest
    pkgs.flyctl
    pkgs.sops
    pkgs.git
    pkgs.libiconv
    pkgs.starship
  ]
  ++ lib.optionals (pkgs.stdenv.isDarwin) [
    pkgs.apple-sdk_15
  ]
  ++ lib.optionals (builtins.getEnv "_PROFILE" == "development") [
    pkgs.starship
  ];

  # Dev-only languages/toolchains
  languages.swift.enable = true;
  languages.rust.enable = true;
  languages.rust.channel = "stable";
  languages.typescript.enable = true;
  languages.nix.enable = true;

  # https://devenv.sh/basics/
  enterShell = ''
    echo "$(starship preset pure-preset)" > $DEVENV_STATE/starship.toml
    export STARSHIP_CONFIG=$DEVENV_STATE/starship.toml
    # eval "$(starship init $SHELL)"
  '';

  # https://devenv.sh/languages/
  # JS + Bun are needed for your `processes.*` commands.
  languages.javascript.enable = true;
  languages.javascript.bun.install.enable = true;
  languages.javascript.bun.enable = true;

  # https://devenv.sh/processes/
  processes.tauri = {
    cwd = "${config.git.root}/apps/native";
    exec = "${pkgs.sops}/bin/sops exec-env ${config.git.root}/.secrets.enc.yaml 'RUST_LOG=nixmac=debug tauri dev'";
  };

  # processes.server = {
  #   cwd = "${config.git.root}/apps/server";
  #   exec = "${pkgs.bun}/bin/bun run dev";
  # };

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

  # Formatting and git-hooks are dev-only; don't ship them into containers.
  treefmt.enable = true;
  treefmt.config = {
    programs.rustfmt.enable = true;
    programs.yamlfmt.enable = true;
    programs.mdformat.enable = true;
  };

  # https://devenv.sh/git-hooks/
  git-hooks = {
    # hooks.biome.enable = true;
    hooks.shellcheck.enable = true;
    hooks.rustfmt.enable = true;
    hooks.clippy.enable = true;
    hooks.mdformat.enable = true;
    excludes = [
      "^.*\/?(\.git|\.direnv|\.devenv|\.vscode|\.idea|\.DS_Store|\.env|\.envrc).*$"
    ];
  };
}
