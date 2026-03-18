{
  pkgs,
  lib,
  config,
  ...
}:
lib.mkIf (!(config.container.isBuilding or false)) {
  # Dev-only packages (excluded from container builds by conditional import).
  packages = [
    pkgs.rustPackages.rustc
    pkgs.rustPackages.cargo
    pkgs.rustPackages.clippy
    pkgs.rustPackages.rustfmt
    pkgs.rust-analyzer
    pkgs.clippy
    pkgs.cargo-watch
    pkgs.cargo-nextest
    pkgs.flyctl
    pkgs.sops
    pkgs.git
    pkgs.libiconv
    pkgs.starship
    pkgs.nixfmt
    pkgs.uv
    pkgs.pyright
    pkgs.ruff
  ]
  ++ lib.optionals (pkgs.stdenv.isDarwin) [
    pkgs.apple-sdk_15
    pkgs.lldb
    pkgs.llvmPackages.bintools
  ]
  ++ lib.optionals (builtins.getEnv "_PROFILE" == "development") [
    pkgs.starship
  ];

  # Dev-only languages/toolchains
  languages.swift.enable = pkgs.stdenv.isDarwin;
  languages.rust.enable = true;
  languages.rust.channel = "stable";
  languages.typescript.enable = true;
  languages.nix.enable = true;
  languages.python = {
    enable = true;
    version = "3.12";
  };

  # https://devenv.sh/basics/
  enterShell = ''
    echo "$(starship preset pure-preset)" > $DEVENV_STATE/starship.toml
    export STARSHIP_CONFIG=$DEVENV_STATE/starship.toml

    # Rust dev settings
    export RUST_BACKTRACE=1
    export RUST_LOG=info

    # Inherit locale settings from host environment
    export LANG=en_US.UTF-8
    export LC_ALL=en_US.UTF-8
    export LC_COLLATE=C

    # Indicate local development environment (for logging, etc.)
    export NIXMAC_ENV=local
    export VITE_NIXMAC_ENV=local
    export NIXMAC_VERSION=local-$(whoami)
    export VITE_NIXMAC_VERSION=local-$(whoami)

    # eval "$(starship init $SHELL)"
  ''
  + lib.optionalString pkgs.stdenv.isDarwin ''
    # For CodeLLDB
    export LLDB_BIN=$(which lldb)
    export DYLD_LIBRARY_PATH=${pkgs.lldb}/lib:$DYLD_LIBRARY_PATH
  '';

  # https://devenv.sh/languages/
  # JS + Bun are needed for your `processes.*` commands.
  languages.javascript.enable = true;
  languages.javascript.bun.install.enable = true;
  languages.javascript.bun.enable = true;

  # https://devenv.sh/processes/
  processes.tauri = {
    cwd = "${config.git.root}/apps/native";
    exec = "${pkgs.sops}/bin/sops exec-env ${config.git.root}/.secrets.enc.yaml 'cd ${config.git.root}/apps/native/src-tauri && cargo run --example export_bindings && cd ${config.git.root}/apps/native && RUST_LOG=nixmac=debug tauri dev'";
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
    programs.rustfmt.enable = false;
    programs.yamlfmt.enable = false;
    programs.mdformat.enable = true;
  };

  # https://devenv.sh/git-hooks/
  git-hooks = {
    # hooks.biome.enable = true;
    hooks.shellcheck.enable = true;
    hooks.rustfmt.enable = false;
    hooks.clippy.enable = false;
    hooks.mdformat.enable = true;
    excludes = [
      "^.*\/?(\.git|\.direnv|\.devenv|\.vscode|\.idea|\.DS_Store|\.env|\.envrc|\.github).*$"
    ];
  };
}
