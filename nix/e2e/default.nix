{
  config,
  lib,
  pkgs,
  ...
}:
let
  nativeDir = "${config.devenv.root}/apps/native";
  tauriDir = "${config.devenv.root}/apps/native/src-tauri";
  disabledProcess = {
    exec = lib.mkOverride 60 "true";
    process-compose.disabled = lib.mkOverride 60 true;
  };
  ensureDependencies = ''
    ${pkgs.bun}/bin/bun install
  '';
in
lib.mkMerge [
  {
    files.".test.sh" = {
      executable = true;
      # script.sh
      text = ''
        set -euo pipefail
        cd ${nativeDir}

        ${ensureDependencies}
        ${pkgs.cargo}/bin/cargo build --manifest-path ${tauriDir}/Cargo.toml --no-default-features

        pkill -x nixmac >/dev/null 2>&1 || true
        for port in 5173 4444; do
          pids="$(lsof -ti tcp:$port 2>/dev/null || true)"
          if [ -n "$pids" ]; then
            kill $pids >/dev/null 2>&1 || true
          fi
        done

        export PC_SOCKET_PATH="$DEVENV_RUNTIME/e2e-process-compose-$$.sock"
        export PC_PORT_NUM=18080
        export PC_DISABLE_TUI=1
        LOG_FILE="$DEVENV_RUNTIME/e2e-process-compose-$$.log"

        cleanup() {
          process-compose -f e2e-tauri/process-compose.yaml down >/dev/null 2>&1 || true
        }
        trap cleanup EXIT

        process-compose \
          -f e2e-tauri/process-compose.yaml \
          --log-file "$LOG_FILE" \
          up --detached --keep-project -t=false

        for port in 5173 4444; do
          for attempt in $(seq 1 120); do
            if ${pkgs.netcat}/bin/nc -z localhost "$port" >/dev/null 2>&1; then
              break
            fi
            if [ "$attempt" -eq 120 ]; then
              echo "Timed out waiting for port $port"
              echo "process-compose logs are at $LOG_FILE"
              exit 1
            fi
            sleep 1
          done
        done

        ${pkgs.bun}/bin/bun run test:wdio
      '';
    };

    profiles.e2e.module =
      { config, lib, ... }:
      lib.mkMerge [
        {
          git-hooks.enable = lib.mkForce false;
          processes.storybook.process-compose.disabled = lib.mkForce true;
        }
        (lib.mkIf (!config.devenv.isTesting) {
          processes = {
            "tauri" = lib.mkForce {
              cwd = nativeDir;
              exec = ''
                ${ensureDependencies}
                ${pkgs.bun}/bin/bun run dev
              '';
              ready.http.get = {
                port = 5173;
                path = "/";
              };
            };

            "tauri-wd" = lib.mkForce {
              cwd = nativeDir;
              exec = ''
                ${ensureDependencies}
                tauri-wd
              '';
            };

            "test" = lib.mkForce {
              cwd = nativeDir;
              exec = ''
                ${pkgs.bun}/bin/bun run test:wdio
              '';
              restart.on = "never";
              after = [
                "devenv:processes:tauri"
                "devenv:processes:tauri-wd@started"
              ];
            };
          };
        })
      ];
  }
  (lib.mkIf config.devenv.isTesting {
    git-hooks.enable = lib.mkForce false;
    processes.storybook.process-compose.disabled = lib.mkForce true;
    processes.tauri = disabledProcess;
    processes."tauri-wd" = disabledProcess;
    processes.test = disabledProcess;
  })
]
