{ pkgs ? import <nixpkgs> { system = builtins.currentSystem; }, releaseVersion ? "dev" }:
let
  serverBinary = ../../apps/server/server;
  webPublic = ../../apps/web/.output/public;
  serverBinarySrc = builtins.path {
    path = serverBinary;
    name = "nixmac-server-binary";
  };
  webPublicSrc = builtins.filterSource (_path: _type: true) webPublic;
in
pkgs.runCommand "nixmac-server-artifact-${releaseVersion}" {
  nativeBuildInputs = [
    pkgs.gnutar
    pkgs.gzip
  ];
} ''
  mkdir -p "$out/release/server" "$out/release/web"

  cp "${serverBinarySrc}" "$out/release/server/server"
  chmod +x "$out/release/server/server"
  cp -R "${webPublicSrc}/." "$out/release/web/"

  cat >"$out/release/release.json" <<EOF
  {
    "version": "${releaseVersion}",
    "serverBinary": "server/server",
    "staticRoot": "web"
  }
  EOF

  tar -C "$out/release" -czf "$out/artifact.tar.gz" .
''
