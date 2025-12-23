# Web app devenv configuration
#
# Note(cooper): This is my first nix2container setup so there's probably extra
# code that can be trimmed. @todo come back later and trim down while verifying
# that everything still works. Definitely a learning curve to nix2container.
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
  # mkDerivation is the core nix function that ultimately builds all derivations
  # which seem to be the name of things that end up in /nix/store. This one
  # block more or less encompasses how to build any container with nix.
  webBuild = pkgs.stdenvNoCC.mkDerivation {
    pname = "web";
    version = "0.1.0";
    src = ../..; # Path without quote = ends up in nix store
    nativeBuildInputs = [ pkgs.bun ];
    buildPhase = ''
      runHook preBuild
      export HOME=$TMPDIR
      bun install --frozen-lockfile
      bun run --filter=web build
      runHook postBuild
    '';
    installPhase = ''
      runHook preInstall
      mkdir -p $out/env/web
      cp -r env/web/.output $out/env/web/.output
      cp -r env/web/public $out/env/web/public
      runHook postInstall
    '';
  };
  # Web bundle: read outside nix store so requires --impure to read it. NOT the
  # canonical way. If you don't git add these files, nix won't see them.
  webOutputDir = config.git.root + "/apps/web/.output";
  webOutputPath = builtins.path {
    path = webOutputDir;
    # Cachebuster to avoid caching (@todo: check if still an issue later)
    name = "web-output-${builtins.substring 0 8 (builtins.hashFile "sha256" (webOutputDir + "/server/index.mjs"))}";
  }; # pkgs.runCommand = "execute this command and capture the output"
  webBundle = pkgs.runCommand "web-bundle" {} ''
    mkdir -p $out
    cp -R ${webOutputPath}/server $out/
    cp -R ${webOutputPath}/public $out/
  '';

  # Equivalent to FROM alpine:latest. hash makes it reproducible. try "distroless"
  # To update: nix-shell -p nix-prefetch-docker --run "nix-prefetch-docker --image-name oven/bun --image-tag slim --arch amd64"
  base = nix2containerPkgs.nix2container.pullImage {
    imageName = "oven/bun";
    imageDigest = "sha256:6111acec4c5a703f2069d6e681967c047920ff2883e7e5a5e64f4ac95ddeb27f";
    arch = "amd64";
    sha256 = "sha256-1WxmFkFx9Pf5qcWOWzFy4/yAwekKL4u06fiAqT05Tyo=";
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


  # tasks."web:build" = {
  #   cwd = "${config.git.root}/apps/web";
  #   exec = ''
  #     # rm -rf /tmp/build
  #     # mkdir -p /tmp/build
  #     nitro build --preset bun
  #     # cp -r .output /tmp/build/.output
  #     # echo "Web build output at /tmp/build/.output"
  #   '';
  #   before = [ "devenv:processes:webserver" ];
  # };
  processes.web = {
    cwd = "${config.git.root}/apps/web";
    exec = ''
      ${pkgs.chamber}/bin/chamber exec nixmac/dev \
        -- ${pkgs.bun}/bin/bun --bun run dev
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
            (pkgsLinux.runCommand "web-app" {} ''
              mkdir -p $out/app/.output
              cp -r ${webBundle}/* $out/app/.output/
            '')
          ];
        })
      ];
      entrypoint = [ "${pkgs.chamber}/bin/chamber" "exec" "nixmac/prod" "--" ];
      config = {
        WorkingDir = "/app";
        Env = [
          "NODE_ENV=production"
          "PORT=3000"
          "SSL_CERT_FILE=/etc/ssl/certs/ca-bundle.crt"
        ];
        ExposedPorts = { "3000/tcp" = {}; };
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
  };

  tasks."deploy-docker:fly" = {
    description = "Deploy to Fly.io (using dockerTools)";
    after = [ "deploy-docker:push" ];
    exec = ''
      echo "🚀 Deploying to Fly.io..."
      ${lib.getExe pkgs.flyctl} deploy --app nixmac
      echo "✅ Deploy complete! Check https://nixmac.fly.dev/"
    '';
  };
}


