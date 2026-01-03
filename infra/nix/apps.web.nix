# Web app devenv configuration
#
# Note(cooper): This is my first nix2container setup so there's probably extra
# code that can be trimmed. @todo come back later and trim down while verifying
# that everything still works. Definitely a learning curve to nix2container.
#
# Build strategy:
# - We build the web app on macOS (impure, using local bun/turbo)
# - The .output directory is then copied into a linux container
# - This avoids cross-compilation issues with native node modules
#
# For pure builds, you'd need a Linux builder (remote or VM).
{ inputs, pkgs, lib, config, ... }:
let
  # Import nixpkgs for x86_64-linux to build amd64 container images for Fly.io
  pkgsLinux = import inputs.nixpkgs {
    system = "x86_64-linux";
  };
  # Explicitly get the linux nix2container packages since we want to build for
  # linux/amd64. self: Figure out if I'm able to build this locally because I
  # am running determinate nix (which supports native linux builds) or if this
  # works on any Mac.
  nix2containerPkgs = inputs.nix2container.packages.x86_64-linux;

  # Web bundle: built impure on macOS, then bundled for container
  # Requires: devenv tasks run deploy:build (or bun run build in apps/web)
  # Using filterSource to bypass gitignore filtering for .output directory.
  webOutputDir = config.git.root + "/apps/web/.output";
  webBundle = pkgs.runCommand "web-bundle" {} ''
    mkdir -p $out
    cp -R ${builtins.filterSource (path: type: true) webOutputDir}/server $out/
    cp -R ${builtins.filterSource (path: type: true) webOutputDir}/public $out/
  '';

  secretsBundle = pkgs.stdenvNoCC.mkDerivation {
    pname = "secrets-bundle";
    version = "0.1.0";
    src = ./..;
    buildPhase = ''
      runHook preBuild
      mkdir -p $out
      cp -r secrets $out/secrets
      runHook postBuild
    '';
  };
  envname = if builtins.getEnv "NIXMAC_ENV" != "" then builtins.getEnv "NIXMAC_ENV" else "dev";

  # Equivalent to FROM alpine:latest. hash makes it reproducible. try "distroless"
  # To update: nix-shell -p nix-prefetch-docker --run "nix-prefetch-docker --image-name oven/bun --image-tag slim --arch amd64"
  base = nix2containerPkgs.nix2container.pullImage {
    imageName = "oven/bun";
    imageDigest = "sha256:6111acec4c5a703f2069d6e681967c047920ff2883e7e5a5e64f4ac95ddeb27f";
    arch = "amd64";
    sha256 = "sha256-1WxmFkFx9Pf5qcWOWzFy4/yAwekKL4u06fiAqT05Tyo=";
  };
  tokenFile = "/tmp/fly-oidc-token";
  bashShell = pkgsLinux.bashInteractive;
  runWeb = pkgsLinux.writeShellApplication {
    name = "run-web";
    runtimeInputs = [
      pkgsLinux.sops
      pkgsLinux.coreutils
      pkgsLinux.jq
    ];
    text = ''
      set -euo pipefail

      # SOPS_AGE_KEY must be set via Fly secrets:
      #   fly secrets set SOPS_AGE_KEY="AGE-SECRET-KEY-..." --app nixmac
      if [ -z "''${SOPS_AGE_KEY:-}" ]; then
        echo "ERROR: SOPS_AGE_KEY not set. Run: fly secrets set SOPS_AGE_KEY='...' --app nixmac" >&2
        exit 1
      fi

      # Decrypt secrets and run the app
      exec sops exec-env /secrets/web.prod.yaml -- \
        ${pkgsLinux.bun}/bin/bun run /app/.output/server/index.mjs
    '';
    # text = ''
    #   set -euo pipefail
    #   export AWS_WEB_IDENTITY_TOKEN_FILE="${tokenFile}"
    #   umask 077
    #   wait_for_socket() {
    #     for tries in $(seq 1 60); do
    #       if [ -S /.fly/api ]; then
    #         return 0
    #       fi
    #       sleep 1
    #     done
    #     echo "Fly API socket /.fly/api never appeared" >&2
    #     return 1
    #   }

    #   if [ ! -s "$AWS_WEB_IDENTITY_TOKEN_FILE" ]; then
    #     wait_for_socket
    #     tries=0
    #     while true; do
    #       token=$(
    #         curl -fsS --unix-socket /.fly/api http://localhost/v1/tokens/oidc \
    #           -H 'Content-Type: application/json' \
    #           -d '{ "aud": "sts.amazonaws.com", "aws_principal_tags": true }' \
    #           | jq -r '.token // empty' || true
    #       )
    #       if [ -n "$token" ]; then
    #         printf '%s' "$token" > "$AWS_WEB_IDENTITY_TOKEN_FILE"
    #         break
    #       fi
    #       tries=$((tries + 1))
    #       if [ "$tries" -ge 30 ]; then
    #         echo "failed to fetch OIDC token after $tries attempts" >&2
    #         exit 1
    #       fi
    #       sleep 1
    #     done
    #   fi
    #   exec ${pkgsLinux.chamber}/bin/chamber exec nixmac/prod -- "$@"
    # '';
  };
in
{

  # Keep the container runtime focused.
  # Dev packages/toolchains/processes live in `devenv.dev.nix` (which is excluded
  # from container builds).
  packages = lib.mkDefault [  ];
  languages.javascript.enable = true;
  languages.javascript.bun.enable = true;
  languages.javascript.directory = "${config.git.root}";
  languages.javascript.bun.install.enable = true;

  processes.webapp = {
    cwd = "${config.git.root}/apps/web";
    exec = ''
      rm -rf /tmp/build
      mkdir -p /tmp/build
      nitro build --preset bun
      cp -r .output /tmp/build/.output
      echo "Web build output at /tmp/build/.output"
    '';
  };
  processes.web = {
    cwd = "${config.git.root}/apps/web";
    exec = ''
      ${pkgs.sops}/bin/sops exec-file \
        ${secretsBundle}/secrets/web.''${NIXMAC_ENV:-dev}.yaml \
        '${pkgs.bun}/bin/bun --bun run dev'
    '';
  };

  containers.web = {
    name = "nixmac";
    registry = "docker://registry.fly.io/";
    defaultCopyArgs = [
      "--dest-creds"
      ''x:"$(${lib.getExe pkgs.flyctl} auth token)"''
    ];

    # Override the derivation to use our custom nix2container image
    # This bypasses devenv's default container building and uses our image directly
    derivation = lib.mkForce (nix2containerPkgs.nix2container.buildImage {
      name = "nixmac";
      tag = "latest";
      fromImage = base;

      # Use layers with reproducible = false to pre-build tarballs
      # This avoids the digest mismatch from runtime tarball generation
      layers = [
        (nix2containerPkgs.nix2container.buildLayer {
          reproducible = false;
          copyToRoot = [
            pkgsLinux.cacert
            pkgsLinux.chamber
            bashShell
            runWeb
            # Include encrypted secrets file
            (pkgsLinux.runCommand "secrets" {} ''
              mkdir -p $out/secrets
              cp -r ${../../infra/secrets/web.prod.yaml} $out/secrets/web.prod.yaml
            '')
            # Web app output (built impure on macOS via deploy:build task)
            (pkgsLinux.runCommand "web-app" {} ''
              mkdir -p $out/app/.output
              cp -r ${webBundle}/* $out/app/.output/
            '')
          ];
        })
      ];
      config =
        let
          baseEnv = [
            "NODE_ENV=production"
            "PORT=3001"
            "SSL_CERT_FILE=/etc/ssl/certs/ca-bundle.crt"
            "AWS_REGION=us-west-2"
            "AWS_WEB_IDENTITY_TOKEN_FILE=${tokenFile}"
            "PATH=/nix/store/bin:${bashShell}/bin:${pkgsLinux.coreutils}/bin:$PATH"
          ];
        in
        {
        entrypoint = [ "${runWeb}/bin/run-web" ];
        WorkingDir = "/app";
        Env = baseEnv;
        ExposedPorts = { "3000/tcp" = {}; "3001/tcp" = {}; };
        User = "65534:65534";
        Cmd = [ "/usr/local/bin/bun" "/app/.output/server/index.mjs" ];
      };
    });
  };

  # ============================================================================
  # Deploy Tasks - run with: devenv tasks run deploy:fly
  # There are two deploy methods and I'm not sure which one is beter yet or if
  # they are even needed. `devenv tasks run deploy:fly` is reliable though.
  # ============================================================================

  # Step 1: Clean previous build
  tasks."deploy:clean" = {
    description = "Clean previous web build output";
    exec = ''
      echo "🧹 Cleaning previous build..."
      rm -rf ${config.git.root}/apps/web/.output
    '';
    showOutput = true;
  };

  # Step 2: Build web app (depends on clean)
  tasks."deploy:build" = {
    description = "Build web app with bun";
    after = [ "deploy:clean" ];
    exec = ''
      echo "📦 Building web app..."
      cd ${config.git.root}/apps/web
      ${lib.getExe pkgs.bun} install
      ${lib.getExe pkgs.bun} run build
    '';
    showOutput = true;
  };

  # Step 3: Push container (depends on build)
  tasks."deploy:push" = {
    description = "Build and push container to Fly.io registry";
    after = [ "deploy:build" ];
    exec = ''
      echo "🐳 Building and pushing container..."
      cd ${config.git.root}
      devenv container --impure copy web
    '';
    showOutput = true;
  };

  # Step 4: Deploy to Fly (depends on push)
  tasks."deploy:fly" = {
    description = "Deploy to Fly.io";
    after = [ "deploy:push" ];
    exec = ''
      echo "🚀 Deploying to Fly.io..."
      ${lib.getExe pkgs.flyctl} deploy --app nixmac
      echo "✅ Deploy complete! Check https://nixmac.fly.dev/"
    '';
    showOutput = true;
  };

  # ============================================================================
  # Alternative: dockerTools deploy (more reliable fallback)
  # Run with: devenv tasks run deploy-docker:fly
  # ============================================================================

  tasks."deploy-docker:clean" = {
    description = "Clean previous web build output";
    exec = ''
      echo "🧹 Cleaning previous build..."
      rm -rf ${config.git.root}/apps/web/.output
    '';
    showOutput = true;
  };

  tasks."deploy-docker:build" = {
    description = "Build web app with bun";
    after = [ "deploy-docker:clean" ];
    exec = ''
      echo "📦 Building web app..."
      cd ${config.git.root}/apps/web
      ${lib.getExe pkgs.bun} install
      ${lib.getExe pkgs.bun} run build
    '';
    showOutput = true;
  };

  tasks."deploy-docker:push" = {
    description = "Build and push container using dockerTools";
    after = [ "deploy-docker:build" ];
    exec = ''
      echo "🐳 Building container image (dockerTools)..."
      cd ${config.git.root}

      IMAGE_TAR=$(nix build --impure --no-link --print-out-paths \
        --expr "import ./infra/nix/docker-build.nix { webOutputPath = ./apps/web/.output; }")

      echo "📤 Pushing to Fly.io registry..."
      FLY_TOKEN=$(${lib.getExe pkgs.flyctl} auth token)
      ${pkgs.skopeo}/bin/skopeo copy \
        --insecure-policy \
        --dest-creds=x:$FLY_TOKEN \
        "docker-archive:$IMAGE_TAR" \
        "docker://registry.fly.io/nixmac:latest"
    '';
    showOutput = true;
  };

  tasks."deploy-docker:fly" = {
    description = "Deploy to Fly.io (using dockerTools)";
    after = [ "deploy-docker:push" ];
    exec = ''
      echo "🚀 Deploying to Fly.io..."
      ${lib.getExe pkgs.flyctl} deploy --app nixmac
      echo "✅ Deploy complete! Check https://nixmac.fly.dev/"
    '';
    showOutput = true;
  };
}
