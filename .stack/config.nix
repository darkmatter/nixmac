{
  enable = true;
  name = "nixmac";
  github = "darkmatter/nixmac";

  cli.enable = true;
  theme.enable = true;
  ide.enable = true;
  ide.vscode.enable = true;

  globalServices = {
    enable = true;
    postgres.enable = true;
  };

  apps = {
    web = {
      name = "Web";
      path = "apps/web";
      type = "bun";
      domain = "web";

      deploy = {
        enable = true;
        targets = [ "edge" ];
        role = "frontend";
      };
    };

    server = {
      name = "Server";
      path = "apps/server";
      type = "bun";
      domain = "api";

      deploy = {
        enable = true;
        targets = [ "nixmac-prod" ];
        role = "backend";
      };
    };
  };

  deployment = {
    machines = {
      nixmac-prod = {
        host = "nixmac-prod";  # will be replaced with real IP after provisioning
        user = "root";
        system = "x86_64-linux";
        authorizedKeys = [
          "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIA+M/DHDlKgayM6wsiX6r704pE+2qENOsKcytC7sBhKA cm@nixmac"
        ];
        modules = [
          ({ pkgs, lib, ... }: {
            # Caddy reverse proxy with automatic TLS for api.nixmac.com
            services.caddy = {
              enable = true;
              email = "cooper@darkmatter.io";
              virtualHosts."api.nixmac.com".extraConfig = ''
                reverse_proxy localhost:3001

                header {
                  Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
                  X-Content-Type-Options "nosniff"
                  X-Frame-Options "DENY"
                  -Server
                }
              '';
            };
            networking.firewall.allowedTCPPorts = [ 80 443 ];
            environment.systemPackages = [ pkgs.bun ];
          })
        ];
      };
    };
  };
}
