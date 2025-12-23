{ webOutputPath }:
let
  pkgsLinux = import <nixpkgs> { system = "x86_64-linux"; };
  webOutput = builtins.path { path = webOutputPath; name = "web-output"; };
in pkgsLinux.dockerTools.buildImage {
  name = "nixmac";
  tag = "latest";
  copyToRoot = pkgsLinux.buildEnv {
    name = "image-root";
    paths = [
      pkgsLinux.bashInteractive
      pkgsLinux.coreutils
      pkgsLinux.bun
      pkgsLinux.cacert
      (pkgsLinux.runCommand "web-app" {} ''
        mkdir -p $out/app/.output
        cp -r ${webOutput}/server $out/app/.output/
        cp -r ${webOutput}/public $out/app/.output/
      '')
    ];
    pathsToLink = [ "/bin" "/etc" "/app" ];
  };
  config = {
    WorkingDir = "/app";
    Env = [ "NODE_ENV=production" "PORT=3000" "SSL_CERT_FILE=/etc/ssl/certs/ca-bundle.crt" ];
    ExposedPorts = { "3000/tcp" = {}; };
    User = "65534:65534";
    Cmd = [ "/bin/bun" "/app/.output/server/index.mjs" ];
  };
}
