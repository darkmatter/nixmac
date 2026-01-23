export const configAsCodeExample = `{
  description = "My Mac configuration";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";
    darwin.url = "github:lnl7/nix-darwin";
  };

  outputs = { self, nixpkgs, darwin }: {
    darwinConfigurations."macbook" = darwin.lib.darwinSystem {
      system = "aarch64-darwin";
      modules = [{
        environment.systemPackages = with nixpkgs; [
          vim git ripgrep fzf
        ];

        homebrew = {
          enable = true;
          casks = [ "rectangle" "raycast" "arc" ];
        };

        system.defaults.dock.autohide = true;
      }];
    };
  };
}` as const;