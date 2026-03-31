# ==============================================================================
# config.nix
#
# Stackpanel project configuration.
# Edit this file to configure your project.
# ==============================================================================
{
  enable = true;
  name = "nixmac";
  github = "darkmatter/nixmac";
  # debug = false;

  # ---------------------------------------------------------------------------
  # Apps
  # ---------------------------------------------------------------------------
  apps = {
    web = {
      bun.enable = true;
      bun.generateFiles = false;
      bun.buildPhase = "bun run build";
      bun.startScript = "bun .output/server/index.mjs";
      commands = {
        dev = {
          command = "bun run dev";
        };
        start = {
          command = "bun run start";
        };
      };
      description = "Main web application";
      name = "web";
      path = "apps/web";
      type = "bun";
      deployment = {
        enable = true;
        backend = "colmena";
        command = "bun run start";
        targets = [ "stackpanel-test" ];
        modules = [
          {
            networking.firewall.allowedTCPPorts = [ 3000 ];
            systemd.services.web.environment = {
              NODE_ENV = "production";
              DATABASE_URL = "postgres://postgres:password@localhost:5432/nixmac-postgres";
            };
          }
        ];
      };
    };
  };

  # ---------------------------------------------------------------------------
  # CLI - Stackpanel command-line tools
  # ---------------------------------------------------------------------------
  cli.enable = true;

  turbo.enable = false;

  # ---------------------------------------------------------------------------
  # Theme - Starship prompt with stackpanel styling
  # See: https://stackpanel.dev/docs/theme
  # ---------------------------------------------------------------------------
  theme.enable = true;
  # theme = {
  #   name = "default";
  #   nerd-font = true;
  #   minimal = false;
  #
  #   colors = {
  #     primary = "#7aa2f7";
  #     secondary = "#bb9af7";
  #     success = "#9ece6a";
  #     warning = "#e0af68";
  #     error = "#f7768e";
  #     muted = "#565f89";
  #   };
  #
  #   starship = {
  #     add-newline = true;
  #     scan-timeout = 30;
  #     command-timeout = 500;
  #   };
  # };

  # ---------------------------------------------------------------------------
  # IDE Integration - Auto-generate editor config files
  # ---------------------------------------------------------------------------
  ide.enable = true;
  ide.vscode.enable = true;

  # ---------------------------------------------------------------------------
  # MOTD - Message of the day shown on shell entry
  # ---------------------------------------------------------------------------
  motd.enable = true;
  motd.commands = [
    {
      name = "dev";
      description = "Start development server";
    }
    {
      name = "build";
      description = "Build the project";
    }
  ];

  # ---------------------------------------------------------------------------
  # Deployment
  # ---------------------------------------------------------------------------
  deployment.machines = {
    stackpanel-test = {
      host = "49.13.150.192";
      user = "root";
      system = "x86_64-linux";
      authorizedKeys = [
        "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDRZy5oeMfqhk91usPMfWM3qZjOu91mhxP5FNISekFeUuHVWciOTjObUquvXcBXPBECsMkkHCuBVW01usaqvMWl0fGGs6oV0oHBjMVNoNTR8PoXklvXQyTVKH4XDHt21guAZcdIyAWrcjGaUbCotN8gbBQ4qJe8EgVrwOHBiIwKzQT8SQKJAkbwLFmQpHfcSpibr/h/UDuEpgKv6dKE5TNiEKdWKYYbCFei98A1Vax56HXVQKVZmzz0WrH3M5uLVi4BG0Ed1o6IjhBl2iJOBNZpuK6N44mc0wUQcqKwshinDPprstfaV5vYsB3U2nDLeNaO1yvOXkOA+PqGeu5Kx5k3 raskolnikov@ce1"
      ];
    };
  };

  # ---------------------------------------------------------------------------
  # Users - Team members with project access
  # Add overrides or additional users here.
  # See: https://stackpanel.dev/docs/users
  # ---------------------------------------------------------------------------
  # users = {
  #   johndoe = {
  #     name = "John Doe";
  #     github = "johndoe";
  #     email = "john@example.com";
  #   };
  # };

  # ---------------------------------------------------------------------------
  # AWS - AWS Roles Anywhere for certificate-based authentication
  # See: https://stackpanel.dev/docs/aws
  # ---------------------------------------------------------------------------
  # aws = {
  #   roles-anywhere = {
  #     enable = true;
  #     region = "us-east-1";
  #     account-id = "123456789012";
  #     role-name = "DeveloperRole";
  #     trust-anchor-arn = "arn:aws:rolesanywhere:us-east-1:123456789012:trust-anchor/...";
  #     profile-arn = "arn:aws:rolesanywhere:us-east-1:123456789012:profile/...";
  #     cache-buffer-seconds = "300";
  #     prompt-on-shell = true;
  #   };
  # };

  # ---------------------------------------------------------------------------
  # Step CA - Internal certificate management for local HTTPS
  # See: https://stackpanel.dev/docs/step-ca
  # ---------------------------------------------------------------------------
  # step-ca = {
  #   enable = true;
  #   ca-url = "https://ca.internal:443";
  #   ca-fingerprint = "abc123...";  # Root CA fingerprint for verification
  #   provisioner = "admin";
  #   cert-name = "dev-workstation";
  #   prompt-on-shell = true;
  # };

  # ---------------------------------------------------------------------------
  # Secrets - SOPS-based secrets management with AGE encryption
  # See: https://stackpanel.dev/docs/secrets
  #
  # On first shell entry with secrets enabled:
  #   - A local AGE key is auto-generated in .stack/keys/
  #   - keys/.sops.yaml is configured to encrypt group keys to your local key
  #
  # To set up a secrets group:
  #   secrets:init-group dev     # generates AGE keypair, encrypts to .enc.age
  #   # Then add the public key to config.nix:
  #   #   secrets.groups.dev.age-pub = "age1...";
  #
  # No AWS/KMS required by default. Add KMS later for team/CI access.
  # ---------------------------------------------------------------------------
  # secrets = {
  #   enable = true;
  #   secrets-dir = ".stack/secrets";
  #
  #   # Groups define access control boundaries
  #   # Each group has its own AGE keypair
  #   # groups = {
  #   #   dev = {};   # Initialize with: secrets:init-group dev
  #   #   prod = {};  # Initialize with: secrets:init-group prod
  #   # };
  #
  #   # Code generation for type-safe env access
  #   # codegen = {
  #   #   typescript = {
  #   #     name = "env";
  #   #     directory = "packages/gen/env/src";
  #   #     language = "CODEGEN_LANGUAGE_TYPESCRIPT";
  #   #   };
  #   # };
  # };

  # ---------------------------------------------------------------------------
  # SST - Infrastructure as code configuration
  # See: https://stackpanel.dev/docs/sst
  # ---------------------------------------------------------------------------
  # sst = {
  #   enable = true;
  #   project-name = "my-project";
  #   region = "us-west-2";
  #   account-id = "123456789012";
  #   config-path = "packages/infra/sst.config.ts";
  #
  #   kms = {
  #     enable = true;
  #     alias = "my-project-secrets";
  #   };
  #
  #   oidc = {
  #     provider = "github-actions";
  #     github-actions = {
  #       org = "my-org";
  #       repo = "*";
  #     };
  #   };
  # };

  # ---------------------------------------------------------------------------
  # Global Services - Shared development services
  # ---------------------------------------------------------------------------
  # globalServices = {
  #   enable = true;
  #   project-name = "myproject";
  #   postgres.enable = true;
  #   redis.enable = true;
  #   minio.enable = true;
  # };

  # ---------------------------------------------------------------------------
  # Caddy - Local HTTPS reverse proxy
  # ---------------------------------------------------------------------------
  # caddy = {
  #   enable = true;
  #   project-name = "myproject";
  # };
}
