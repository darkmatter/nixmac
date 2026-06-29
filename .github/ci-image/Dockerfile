# syntax=docker/dockerfile:1
# =============================================================================
# nixmac CI image (Linux)
#
# Pre-bakes everything the Linux GitHub Actions jobs need so each run skips
# the ~5-10 min of nix-installer + cachix + devenv CLI + system dep installs.
#
# Baked in:
#   - Determinate Nix (--init none, daemon started by ci-entrypoint.sh)
#   - Cachix CLI + pre-configured binary caches (darkmatter, devenv, nixpkgs-python)
#   - SOPS + age (secrets decryption)
#   - Bun (version pinned to package.json packageManager)
#   - Node.js 22 (via nix profile)
#   - System deps: build-essential, git, rsync, ffmpeg, jq, openssh, etc.
#
# Not baked in (repo-specific, must build per job):
#   - devenv profile (depends on devenv.nix inputs)
#   - Rust toolchain (dtolnay/rust-toolchain handles this per job)
#   - node_modules (bun install per job)
#
# Usage in workflows:
#   container:
#     image: ghcr.io/darkmatter/nixmac-ci:latest
#     credentials:
#       username: ${{ github.actor }}
#       password: ${{ secrets.GITHUB_TOKEN }}
# =============================================================================

FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8

# ---- System packages --------------------------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential \
      pkg-config \
      libssl-dev \
      ca-certificates \
      curl \
      git \
      openssh-client \
      rsync \
      ffmpeg \
      jq \
      xz-utils \
      sudo \
      procps \
      lsof \
      file \
      unzip \
      zip \
    && rm -rf /var/lib/apt/lists/*

# ---- Determinate Nix (multi-user, no init system) ---------------------------
# --init none: no systemd service. ci-entrypoint.sh starts nix-daemon at
# container start. The nix-installer-action in the setup composite action
# detects the existing install and skips.
RUN curl -fsSL https://install.determinate.systems/nix | sh -s -- install linux \
      --init none \
      --extra-conf "trusted-users = root" \
      --extra-conf "max-jobs = 2" \
      --no-confirm

# Make nix tools available on PATH for all users.
# /nix/var/nix/profiles/default/bin is the default profile bin dir.
ENV PATH="/nix/var/nix/profiles/default/bin:/root/.nix-profile/bin:${PATH}"

# ---- Nix packages + binary cache config -------------------------------------
# Each RUN is a separate Docker layer — background processes (nix-daemon) do
# NOT persist between RUN commands. Start the daemon at the top of this RUN,
# install nix packages, configure binary caches, verify, then kill the daemon.
ENV USER=root

RUN nix-daemon &>/var/log/nix-daemon.log & \
    DAEMON_PID=$! && \
    sleep 3 && \
    nix profile install \
      nixpkgs#cachix \
      nixpkgs#sops \
      nixpkgs#age \
      nixpkgs#nodejs_22 \
      nixpkgs#treefmt \
      nixpkgs#nixfmt \
    && \
    # Configure binary caches (no auth needed for pull-only access).
    # `cachix use` fetches public keys from the cachix API and writes
    # substituters + trusted-public-keys to /etc/nix/nix.conf.
    cachix use darkmatter && \
    cachix use devenv && \
    cachix use nixpkgs-python && \
    # Verify all nix-installed tools are on PATH.
    nix --version && \
    cachix --version && \
    sops --version && \
    age --version && \
    node --version && \
    treefmt --version && \
    nixfmt --version && \
    kill "$DAEMON_PID" 2>/dev/null || true

# ---- Bun --------------------------------------------------------------------
# Version pinned to match package.json `packageManager` field.
ARG BUN_VERSION=1.3.14
RUN BUN_TAG="bun-v${BUN_VERSION}" && \
    curl -fsSL "https://github.com/oven-sh/bun/releases/download/${BUN_TAG}/bun-linux-x64.zip" -o /tmp/bun.zip && \
    unzip -q /tmp/bun.zip -d /tmp/bun && \
    mv /tmp/bun/bun-linux-x64/bun /usr/local/bin/bun && \
    chmod +x /usr/local/bin/bun && \
    rm -rf /tmp/bun /tmp/bun.zip && \
    bun --version
ENV BUN_INSTALL="/root/.bun"
ENV PATH="/usr/local/bin:${BUN_INSTALL}/bin:${PATH}"

# ---- Non-nix system tools verification --------------------------------------
RUN git --version && rsync --version | head -1 && jq --version && ffmpeg -version | head -1

# ---- Entrypoint -------------------------------------------------------------
# GitHub Actions starts the container with a keepalive command (tail -f /dev/null)
# and execs each step via `docker exec`. The entrypoint starts nix-daemon in
# the background so nix commands work inside exec'd steps.
COPY ci-entrypoint.sh /usr/local/bin/ci-entrypoint.sh
RUN chmod +x /usr/local/bin/ci-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/ci-entrypoint.sh"]
CMD ["tail", "-f", "/dev/null"]
