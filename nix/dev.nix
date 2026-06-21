{
  pkgs,
  lib,
  config,
  ...
}:
let
  playwright-driver = pkgs.playwright-driver;
  playwright-driver-browsers = pkgs.playwright-driver.browsers;

  playright-file = builtins.readFile "${playwright-driver}/browsers.json";
  playright-json = builtins.fromJSON playright-file;
  playwright-chromium-entry = builtins.elemAt (builtins.filter (
    browser: browser.name == "chromium"
  ) playright-json.browsers) 0;
  playwright-chromium-revision = playwright-chromium-entry.revision;
in
lib.mkIf (!config.container.isBuilding) {
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
    pkgs.age
    pkgs.sops
    pkgs.git
    pkgs.gh
    pkgs.libiconv
    pkgs.starship
    pkgs.nixfmt
    pkgs.uv
    pkgs.pyright
    pkgs.ruff
    pkgs.yq
    pkgs.playwright
    pkgs.oxfmt
    pkgs.oxlint
    # Python packages used in one-off scripts
    pkgs.python312Packages.requests
    pkgs.python312Packages.beautifulsoup4

    pkgs.process-compose
  ]
  ++ lib.optionals (pkgs.stdenv.isDarwin) [
    pkgs.apple-sdk_15
    pkgs.lldb
    pkgs.llvmPackages.bintools
    (pkgs.callPackage ./pkgs/tauri-wd.nix { })
    pkgs.tart
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

    # Cargo invokes the macOS linker with -liconv for proc-macro crates.
    # Expose nix libiconv so CI runners can link without relying on host paths.
    export LIBRARY_PATH=${pkgs.libiconv}/lib:''${LIBRARY_PATH:-}
    export RUSTFLAGS="-L native=${pkgs.libiconv}/lib ''${RUSTFLAGS:-}"
  ''
  + lib.optionalString pkgs.stdenv.isLinux ''
    export PLAYWRIGHT_BROWSERS_PATH=${pkgs.playwright-driver.browsers}
    export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

    export LD_LIBRARY_PATH=${
      lib.makeLibraryPath [
        pkgs.glib
        pkgs.nss
        pkgs.nspr
        pkgs.atk
        pkgs.at-spi2-atk
        pkgs.at-spi2-core
        pkgs.dbus
        pkgs.expat
        pkgs.libxkbcommon
        pkgs.pango
        pkgs.cairo
        pkgs.fontconfig
        pkgs.freetype
        pkgs.cups
        pkgs.libdrm
        pkgs.libgbm
        pkgs.alsa-lib
        pkgs.libxshmfence
        pkgs.gdk-pixbuf
        pkgs.gtk3
        pkgs.udev
        pkgs.xorg.libX11
        pkgs.xorg.libXcomposite
        pkgs.xorg.libXdamage
        pkgs.xorg.libXext
        pkgs.xorg.libXfixes
        pkgs.xorg.libXrandr
        pkgs.xorg.libxcb
      ]
    }:''${LD_LIBRARY_PATH:-}
  '';

  # https://devenv.sh/languages/
  # JS + Bun are needed for your `processes.*` commands.
  languages.javascript.enable = true;
  languages.javascript.bun.install.enable = true;
  languages.javascript.bun.enable = true;

  env.SOPS_KEYSERVICE = "tcp://100.116.189.36:5000";
  # TODO: add MacOS support to omit this
  env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = "${playwright-driver-browsers}/chromium-${playwright-chromium-revision}/chrome-linux/chrome";
  # This is used by npx playwright --{ui,debug,...}
  env.PLAYWRIGHT_BROWSERS_PATH = "${playwright-driver-browsers}";

  # https://devenv.sh/processes/
  # Use process-compose as the process manager for the TUI
  process.manager.implementation = "process-compose";

  processes.tauri = {
    cwd = "${config.git.root}/apps/native";
    exec = "${pkgs.sops}/bin/sops exec-env ${config.git.root}/ops/secrets/secrets.yaml '${config.git.root}/apps/native/src-tauri/scripts/tauri-dev.sh'";
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
    exec = "sops exec-env ${config.git.root}/ops/secrets/secrets.yaml 'bun run test:watch'";
  };

  # Formatting
  treefmt.enable = true;
  treefmt.config = {
    # The commit hook runs treefmt repo-wide; enabling more formatters here
    # expands pre-commit cost and can surface unrelated formatting drift.
    programs.rustfmt.enable = true;
    programs.yamlfmt.enable = false;
    programs.mdformat.enable = true;
  };

  # Git hooks (pure Nix-native, no pre-commit)
  # Prefer treefmt to git-hooks when available
  git-hooks = {
    enable = true;

    # Run treefmt on commit
    hooks.treefmt.enable = true;
    # Pinned git-hooks.nix forces treefmt pass_filenames=true; override until
    # the pinned upstream default is false.
    hooks.treefmt.pass_filenames = lib.mkForce false;

    hooks.shellcheck.enable = true;
    excludes = [
      "^.*\/?(\.git|\.direnv|\.devenv|\.vscode|\.idea|\.DS_Store|\.env|\.envrc|\.github).*$"
    ];
  };
}
