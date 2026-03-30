{
  description = "Nixmac — macOS configuration toolkit (API backend + desktop app)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.11";
    infra.url = "github:darkmatter/infra";
    infra.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs =
    { self
    , nixpkgs
    , infra
    }:
  let
    system = "x86_64-linux";
    pkgs = nixpkgs.legacyPackages.${system};

    # ──────────────────────────────────────────────────────────────────────────
    # nixmac-prod — Hetzner CX22 in Nuremberg
    #
    # Runs the Hono/tRPC API server fronted by Caddy for TLS.
    # The Vite frontend deploys separately to Cloudflare Workers
    # via apps/web/alchemy.run.ts (unchanged).
    # ──────────────────────────────────────────────────────────────────────────
    server = infra.lib.mkHetznerServer {
      name       = "nixmac-prod";
      serverType = "cx22";
      location   = "nbg1";
      sshKeyName = "cm-nixmac";

      hostname = "nixmac-prod";

      modules = [
        # ── Nixmac API server: Bun systemd service + Caddy TLS ──────────────
        ({ config, pkgs, lib, ... }:
        let
          cfg = config.nixmac.server;
        in {
          options.nixmac.server = {
            enable = lib.mkEnableOption "Nixmac API server (Hono + tRPC)";

            port = lib.mkOption {
              type = lib.types.port;
              default = 3001;
              description = "Port the server listens on (localhost only).";
            };

            appDir = lib.mkOption {
              type = lib.types.str;
              default = "/opt/nixmac";
              description = "Path to the nixmac repo on disk.";
            };

            domain = lib.mkOption {
              type = lib.types.str;
              default = "api.nixmac.com";
              description = "Public domain for Caddy TLS.";
            };

            acmeEmail = lib.mkOption {
              type = lib.types.str;
              default = "cooper@darkmatter.io";
              description = "ACME contact email for Let's Encrypt.";
            };

            environmentFile = lib.mkOption {
              type = lib.types.nullOr lib.types.path;
              default = null;
              description = ''
                Dotenv-format file with: DATABASE_URL, BETTER_AUTH_SECRET,
                BETTER_AUTH_URL, CORS_ORIGIN
              '';
            };

            extraEnvironment = lib.mkOption {
              type = lib.types.attrsOf lib.types.str;
              default = {};
              description = "Non-secret environment variables.";
            };
          };

          config = lib.mkIf cfg.enable {
            environment.systemPackages = [ pkgs.bun ];

            systemd.services.nixmac-server = {
              description = "Nixmac API (Hono + tRPC + Better-Auth)";
              wantedBy = [ "multi-user.target" ];
              after = [ "network-online.target" ];
              wants = [ "network-online.target" ];

              environment = cfg.extraEnvironment // {
                PORT     = toString cfg.port;
                NODE_ENV = "production";
              };

              serviceConfig = {
                Type             = "simple";
                WorkingDirectory = "${cfg.appDir}/apps/server";
                ExecStart        = "${pkgs.bun}/bin/bun run dist/index.mjs";
                Restart          = "always";
                RestartSec       = 5;
                EnvironmentFile  = lib.optional (cfg.environmentFile != null) cfg.environmentFile;
                NoNewPrivileges  = true;
                ProtectSystem    = "strict";
                ProtectHome      = true;
                ReadWritePaths   = [ cfg.appDir ];
                PrivateTmp       = true;
              };
            };

            services.caddy = {
              enable = true;
              email  = cfg.acmeEmail;

              virtualHosts.${cfg.domain}.extraConfig = ''
                reverse_proxy localhost:${toString cfg.port}

                header {
                  Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
                  X-Content-Type-Options "nosniff"
                  X-Frame-Options "DENY"
                  Referrer-Policy "strict-origin-when-cross-origin"
                  -Server
                }
              '';
            };

            networking.firewall.allowedTCPPorts = [ 80 443 ];
          };
        })

        # ── Enable the service with production config ────────────────────────
        ({ ... }: {
          nixmac.server = {
            enable          = true;
            domain          = "api.nixmac.com";
            environmentFile = "/opt/nixmac/.env.production";
          };
        })
      ];
    };

    # ──────────────────────────────────────────────────────────────────────────
    # Fast code-deploy: rsync → bun install → bun build → restart
    # Use for every server code change (no NixOS rebuild needed).
    # ──────────────────────────────────────────────────────────────────────────
    deployCodeApp = {
      type = "app";
      program =
        let
          script = pkgs.writeShellApplication {
            name = "deploy";
            runtimeInputs = [ pkgs.rsync pkgs.openssh pkgs.bun ];
            text = ''
              set -euo pipefail
              HOST="root@$(hcloud server ip nixmac-prod 2>/dev/null || echo "''${NIXMAC_HOST:-}")"
              if [[ -z "$HOST" || "$HOST" == "root@" ]]; then
                echo "Error: cannot resolve nixmac-prod IP." >&2
                echo "  Set NIXMAC_HOST=<ip> or ensure HCLOUD_TOKEN is set." >&2
                exit 1
              fi
              REMOTE="/opt/nixmac"

              echo "→ Syncing source to $HOST:$REMOTE ..."
              rsync -az --delete \
                --exclude '.git' \
                --exclude 'node_modules' \
                --exclude 'target' \
                --exclude '.env*' \
                --exclude 'apps/*/dist' \
                --exclude 'apps/native' \
                --exclude '*.age' \
                "$PWD/" "$HOST:$REMOTE/"

              echo "→ Installing dependencies ..."
              ssh "$HOST" "cd $REMOTE && bun install --frozen-lockfile"

              echo "→ Building server ..."
              ssh "$HOST" "cd $REMOTE/apps/server && bun run build"

              echo "→ Restarting nixmac-server ..."
              ssh "$HOST" "systemctl restart nixmac-server"

              echo "→ Health check (10 s) ..."
              sleep 10
              ssh "$HOST" "curl -sf http://localhost:3001/healthz && echo ' ✓' || (systemctl status --no-pager -n 20 nixmac-server; exit 1)"

              echo "✓ Deploy complete — api.nixmac.com"
            '';
          };
        in
        "${script}/bin/deploy";
    };

  in {
    # ── NixOS configuration ───────────────────────────────────────────────────
    nixosConfigurations.nixmac-prod = server.nixosConfig;

    # ── Colmena day-2 node ────────────────────────────────────────────────────
    colmena = {
      meta.nixpkgs = import nixpkgs { inherit system; };
      nixmac-prod  = server.colmenaNode;
    };

    # ── Flake apps ────────────────────────────────────────────────────────────
    apps.${system} = {
      # Fast: rsync code + bun build + restart (every code change)
      deploy        = deployCodeApp;

      # Full: nixos-rebuild switch (NixOS module / Caddy / firewall changes)
      deploy-config = server.deployApp;

      # Lifecycle
      create  = server.createApp;
      install = server.installApp;
      status  = server.statusApp;
      destroy = server.destroyApp;
    };

    # ── Default app ───────────────────────────────────────────────────────────
    defaultApp.${system} = deployCodeApp;
  };
}
