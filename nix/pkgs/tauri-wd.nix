{
  lib,
  rustPlatform,
  fetchFromGitHub,
  stdenv,
  apple-sdk_15,
}:
rustPlatform.buildRustPackage rec {
  pname = "tauri-webdriver-automation";
  version = "0.1.3-unstable-2026-05-23";

  src = fetchFromGitHub {
    owner = "danielraffel";
    repo = "tauri-webdriver";
    rev = "e61687f1c8c26a9998ef4086dd552dfb38eb62ed";
    hash = "sha256-8pW3cGhmrkSouC+N/N3ETJxEK1zgHjR3OfMTudG9ie4=";
  };

  cargoHash = "sha256-UlJ+z6++0W1aHXUSQ3whAuX6sq34x9IoB9N1NlnFyh8=";

  cargoBuildFlags = [
    "-p"
    "tauri-webdriver-automation"
  ];

  # The workspace also contains the in-app Tauri plugin and a fixture, neither
  # of which builds standalone. Run no tests; we only ship the `tauri-wd` binary.
  doCheck = false;

  buildInputs = lib.optionals stdenv.isDarwin [ apple-sdk_15 ];

  meta = {
    description = "macOS WebDriver server for Tauri apps (provides the tauri-wd binary)";
    homepage = "https://github.com/danielraffel/tauri-webdriver";
    license = with lib.licenses; [
      mit
      asl20
    ];
    mainProgram = "tauri-wd";
    platforms = lib.platforms.darwin;
  };
}
