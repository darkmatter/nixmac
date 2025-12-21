# Custom packages and apps
{ inputs, self, ... }:

{
  perSystem = { pkgs, system, ... }: {
    packages = {
      # Darwin rebuild helper script
      darwin-rebuild-wrapper = pkgs.writeShellApplication {
        name = "darwin-switch";
        runtimeInputs = [ inputs.darwin.packages.${system}.darwin-rebuild ];
        text = ''
          echo "🔄 Rebuilding Darwin configuration..."
          HOST_FILE="''${XDG_CONFIG_HOME:-''${HOME}/.config}/darwin/host"
          if [ -f "$HOST_FILE" ]; then
            HOST_ATTR="$(sed -e 's/[[:space:]]*$//' "$HOST_FILE")"
          else
            HOST_ATTR="$(scutil --get HostName 2>/dev/null || hostname -s)"
            if [ -z "$HOST_ATTR" ]; then
              HOST_ATTR="$(scutil --get LocalHostName 2>/dev/null || hostname)"
            fi
          fi
          darwin-rebuild switch --flake ".#$HOST_ATTR" "$@"
          echo "✅ Darwin configuration applied!"
        '';
      };

      # Cachix deploy spec
      cachix-deploy-spec = pkgs.writeTextFile {
        name = "cachix-deploy.json";
        text = builtins.toJSON {
          agents = {
            "macbook-pro" = self.darwinConfigurations."macbook-pro".system;
            "mac-pro" = self.darwinConfigurations."mac-pro".system;
          };
        };
      };

      # Default package
      default = self.packages.${system}.darwin-rebuild-wrapper;
    };

    # Apps
    apps = {
      default = {
        type = "app";
        program = "${self.packages.${system}.darwin-rebuild-wrapper}/bin/darwin-switch";
      };
    };
  };
}

