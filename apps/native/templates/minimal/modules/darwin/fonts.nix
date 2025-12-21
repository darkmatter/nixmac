# Font configuration
{ config, pkgs, lib, ... }:

{
  fonts = {
    packages = with pkgs; [
      # Nerd Fonts
      nerd-fonts.fira-code
      nerd-fonts.meslo-lg
      nerd-fonts.jetbrains-mono

      # Standard fonts
      fira-code
      jetbrains-mono
      roboto

      # Monaspace font from GitHub
      (pkgs.stdenv.mkDerivation rec {
        pname = "monaspace";
        version = "master-${builtins.substring 0 7 src.rev}";

        src = pkgs.fetchFromGitHub {
          owner = "githubnext";
          repo = "monaspace";
          rev = "master";
          sha256 = "sha256-8tPwm92ZtaXL9qeDL+ay9PdXLUBBsspdk7/0U8VO0Tg=";
        };

        nativeBuildInputs = [
          pkgs.nodejs
          pkgs.python3
        ];

        buildPhase = ''
          echo "Fonts are pre-built in the repository"
        '';

        installPhase = ''
          mkdir -p $out/share/fonts/opentype
          mkdir -p $out/share/fonts/truetype
          mkdir -p $out/share/fonts/variable
          mkdir -p $out/share/fonts/woff

          # Copy Static Fonts (OTF)
          if [ -d "fonts/Static Fonts" ]; then
            find "fonts/Static Fonts" -name "*.otf" -exec cp {} $out/share/fonts/opentype/ \;
          fi

          # Copy Variable Fonts
          if [ -d "fonts/Variable Fonts" ]; then
            find "fonts/Variable Fonts" -name "*.ttf" -exec cp {} $out/share/fonts/variable/ \;
          fi

          # Copy Web Fonts
          if [ -d "fonts/Web Fonts" ]; then
            find "fonts/Web Fonts" -name "*.woff" -o -name "*.woff2" -exec cp {} $out/share/fonts/woff/ \;
          fi

          # Also check for regular TTF fonts
          find fonts -name "*.ttf" -exec cp {} $out/share/fonts/truetype/ \; 2>/dev/null || true
        '';
      })
    ];
  };
}

