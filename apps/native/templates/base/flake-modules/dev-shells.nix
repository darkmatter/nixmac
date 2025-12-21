# Development shells
{ inputs, self, ... }:

{
  perSystem = { pkgs, system, ... }: {
    devShells.default = pkgs.mkShell {
      packages = with pkgs; [
        nixfmt-rfc-style
        nil
        git
        cachix
        self.packages.${system}.darwin-rebuild-wrapper
      ];

      shellHook = ''
        echo "🍎 Darwin configuration dev shell"
        echo "   Run 'darwin-switch' to rebuild"
      '';
    };

    # Formatter
    formatter = pkgs.nixfmt-rfc-style;
  };
}

