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
{
  inputs,
  pkgs,
  lib,
  config,
  ...
}:
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
  webBundle = pkgs.runCommand "web-bundle" { } ''
    mkdir -p $out
    cp -R ${builtins.filterSource (path: type: true) webOutputDir}/server $out/
    cp -R ${builtins.filterSource (path: type: true) webOutputDir}/public $out/
  '';

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
      pkgsLinux.curl
      pkgsLinux.awscli2
    ];
    text = ''
      set -euo pipefail

      echo "==> Authenticating to AWS using Fly.io OIDC..."

      # Print AWS environment variables for diagnostics
      echo "==> AWS Environment Variables:"
      echo "    AWS_ROLE_ARN: ''${AWS_ROLE_ARN:-<not set>}"
      echo "    AWS_WEB_IDENTITY_TOKEN_FILE: ''${AWS_WEB_IDENTITY_TOKEN_FILE:-<not set>}"
      echo "    AWS_ROLE_SESSION_NAME: ''${AWS_ROLE_SESSION_NAME:-<not set>}"

      # Check what files exist in /.fly/
      echo "==> Checking /.fly/ directory:"
      if [ -d "/.fly" ]; then
        ls -la /.fly/ || echo "    Unable to list /.fly/"
      else
        echo "    /.fly/ directory does not exist"
      fi

      # Retry logic: attempt to get OIDC token up to 10 times with 10 second sleep between attempts
      MAX_ATTEMPTS=10
      ATTEMPT=1
      FLY_OIDC_TOKEN=""

      # First, wait for the OIDC token file to be created by Fly.io
      if [ -n "''${AWS_WEB_IDENTITY_TOKEN_FILE:-}" ]; then
        echo "==> Waiting for OIDC token file at ''${AWS_WEB_IDENTITY_TOKEN_FILE}..."
        FILE_WAIT_ATTEMPTS=0
        MAX_FILE_WAIT=30  # Wait up to 30 seconds for the file to appear

        while [ $FILE_WAIT_ATTEMPTS -lt $MAX_FILE_WAIT ]; do
          if [ -f "''${AWS_WEB_IDENTITY_TOKEN_FILE}" ]; then
            echo "    OIDC token file found after ''${FILE_WAIT_ATTEMPTS} seconds"
            break
          fi
          sleep 1
          FILE_WAIT_ATTEMPTS=$((FILE_WAIT_ATTEMPTS + 1))
        done

        if [ ! -f "''${AWS_WEB_IDENTITY_TOKEN_FILE}" ]; then
          echo "    WARNING: OIDC token file not found after ''${MAX_FILE_WAIT} seconds, will try API endpoint"
        fi
      fi

      # Try reading from the file if it exists
      if [ -n "''${AWS_WEB_IDENTITY_TOKEN_FILE:-}" ] && [ -f "''${AWS_WEB_IDENTITY_TOKEN_FILE}" ]; then
        echo "==> Reading OIDC token from file at ''${AWS_WEB_IDENTITY_TOKEN_FILE}..."
        if FLY_OIDC_TOKEN=$(cat "''${AWS_WEB_IDENTITY_TOKEN_FILE}" 2>&1); then
          echo "==> Successfully read OIDC token from file (length: ''${#FLY_OIDC_TOKEN})"
          echo "    Token preview (first 50 chars): ''${FLY_OIDC_TOKEN:0:50}..."
        else
          echo "    Failed to read token from file, will try API endpoint"
          FLY_OIDC_TOKEN=""
        fi
      fi

      # If token file read failed or doesn't exist, fall back to API call
      if [ -z "$FLY_OIDC_TOKEN" ]; then
        # Wait for Fly API socket
        echo "==> Waiting for Fly API socket..."
        for tries in $(seq 1 60); do
          if [ -S /.fly/api ]; then
            echo "    Fly API socket found after $tries seconds"
            break
          fi
          sleep 1
        done
        if [ ! -S /.fly/api ]; then
          echo "ERROR: Fly API socket /.fly/api never appeared" >&2
          exit 1
        fi

        while [ $ATTEMPT -le $MAX_ATTEMPTS ]; do
          echo "==> Attempt $ATTEMPT of $MAX_ATTEMPTS: Fetching OIDC token from Fly.io API..."

          # Capture both stdout and stderr, and the exit code
          set +e
          RESPONSE=$(curl -s --unix-socket /.fly/api -X POST "http://localhost/v1/tokens/oidc" \
            -H 'Content-Type: application/json' \
            -d '{ "aud": "sts.amazonaws.com", "aws_principal_tags": true }' 2>&1)
          CURL_EXIT_CODE=$?
          set -e

          echo "    Curl exit code: $CURL_EXIT_CODE"
          echo "    Response length: ''${#RESPONSE}"

          if [ $CURL_EXIT_CODE -eq 0 ] && [ -n "$RESPONSE" ]; then
            # Extract token from JSON response
            FLY_OIDC_TOKEN=$(echo "$RESPONSE" | jq -r '.token // empty' || true)
            if [ -n "$FLY_OIDC_TOKEN" ]; then
              echo "==> Successfully retrieved OIDC token from API (length: ''${#FLY_OIDC_TOKEN})"
              # Write token to file for AWS SDK
              umask 077
              printf '%s' "$FLY_OIDC_TOKEN" > "${tokenFile}"
              export AWS_WEB_IDENTITY_TOKEN_FILE="${tokenFile}"
              break
            fi
          fi

          if [ $ATTEMPT -lt $MAX_ATTEMPTS ]; then
            echo "    Failed to retrieve token. Sleeping 10 seconds before retry..."
            sleep 10
          fi

          ATTEMPT=$((ATTEMPT + 1))
        done
      fi

      if [ -z "$FLY_OIDC_TOKEN" ]; then
        echo "ERROR: Failed to retrieve OIDC token after $MAX_ATTEMPTS attempts" >&2
        exit 1
      fi

      # Decode and display JWT token claims for debugging
      echo "==> Decoding OIDC token (JWT) for diagnostics..."
      # Extract and decode the payload (middle part of JWT)
      TOKEN_PAYLOAD=$(echo "$FLY_OIDC_TOKEN" | cut -d'.' -f2)
      # Add padding if needed for base64 decoding
      case $((''${#TOKEN_PAYLOAD} % 4)) in
        2) TOKEN_PAYLOAD="''${TOKEN_PAYLOAD}==";;
        3) TOKEN_PAYLOAD="''${TOKEN_PAYLOAD}=";;
      esac
      echo "    Token claims:"
      echo "$TOKEN_PAYLOAD" | base64 -d 2>/dev/null | jq '.' 2>/dev/null || echo "    Unable to decode token payload"

      echo "==> Assuming AWS role with web identity..."
      if ! CREDENTIALS=$(aws sts assume-role-with-web-identity \
        --role-arn "''${AWS_ROLE_ARN}" \
        --role-session-name "nixmac-flyio-$(date +%s)" \
        --web-identity-token "$FLY_OIDC_TOKEN" \
        --duration-seconds 3600 \
        --output json 2>&1); then
        echo "ERROR: Failed to assume AWS role" >&2
        echo "AWS Error: $CREDENTIALS" >&2
        exit 1
      fi

      # Export AWS credentials for this session
      export AWS_ACCESS_KEY_ID=$(echo "''${CREDENTIALS}" | jq -r '.Credentials.AccessKeyId')
      export AWS_SECRET_ACCESS_KEY=$(echo "''${CREDENTIALS}" | jq -r '.Credentials.SecretAccessKey')
      export AWS_SESSION_TOKEN=$(echo "''${CREDENTIALS}" | jq -r '.Credentials.SessionToken')

      echo "==> AWS credentials configured successfully"
      echo "==> Fetching secrets from AWS SSM via Chamber and starting app..."

      exec ${pkgsLinux.chamber}/bin/chamber exec nixmac/prod -- "$@"
    '';
  };
in
{

  # Keep the container runtime focused.
  # Dev packages/toolchains/processes live in `devenv.dev.nix` (which is excluded
  # from container builds).
  packages = lib.mkDefault [ ];
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
      ${pkgs.sops}/bin/sops exec-env \
        ${config.git.root}/.secrets.enc.yaml \
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
    derivation = lib.mkForce (
      nix2containerPkgs.nix2container.buildImage {
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
              (pkgsLinux.runCommand "secrets" { } ''
                mkdir -p $out/secrets
                cp -r ${../../infra/secrets/web.prod.yaml} $out/secrets/web.prod.yaml
              '')
              # Web app output (built impure on macOS via deploy:build task)
              (pkgsLinux.runCommand "web-app" { } ''
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
            ExposedPorts = {
              "3000/tcp" = { };
              "3001/tcp" = { };
            };
            User = "65534:65534";
            Cmd = [
              "/usr/local/bin/bun"
              "/app/.output/server/index.mjs"
            ];
          };
      }
    );
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
