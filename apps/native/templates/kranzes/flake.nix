{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    nix-darwin = { url = "github:LnL7/nix-darwin"; inputs.nixpkgs.follows = "nixpkgs"; };
  };

  outputs = { self, ... }@inputs: {
    darwinConfigurations."macbook" = inputs.nix-darwin.lib.darwinSystem {
      system = "aarch64-darwin";
      inputs = { inherit inputs; };
      modules = [
        ./configuration.nix
      ];
    };
  };
}
