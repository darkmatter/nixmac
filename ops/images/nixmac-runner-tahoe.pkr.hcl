# =============================================================================
# nixmac CI image (macOS / Tahoe)
#
# Pre-bakes everything the macOS GitHub Actions runner needs so each build
# skips ~5-10 min of nix-installer + cachix + bun + system dep installs.
#
# Base: ghcr.io/cirruslabs/macos-tahoe-xcode:26.5 (transitively vanilla-Tahoe-
# based via -base; carries a single Xcode 26.5 — smaller than macos-runner:tahoe
# which bundles multiple Xcode versions).
#
# Baked in (system-level, version-stable):
#   - Determinate Nix (multi-user, no init system)
#   - Cachix CLI + pre-configured binary caches (darkmatter, devenv, nixpkgs-python)
#   - SOPS + age (secrets decryption)
#   - Bun (version pinned to package.json packageManager)
#   - Node.js 22 (via nix profile)
#   - treefmt, nixfmt (via nix profile)
#
# NOT baked in (repo/lockfile-dependent — must build per job):
#   - devenv profile (depends on devenv.nix + flake.lock)
#   - Rust toolchain (managed by devenv profile per job)
#   - node_modules (bun install per job — depends on bun.lock)
#   - Cargo registry cache (changes per Cargo.lock)
#
# This mirrors the Linux CI image (.github/ci-image/Dockerfile) philosophy:
# bake toolchain installers and system-level tools, not per-repo artifacts.
#
# SECURITY: This template uses PUBLIC inputs only. No SOPS_AGE_KEY, Cachix auth
# tokens, Apple signing keys, or API keys are injected. The image is safe to
# publish to a public registry. Secrets are provided at job runtime via the
# existing workflow secret injection.
#
# Usage:
#   packer init .
   # packer build -var "bun_version=1.3.14" .
#   tart push nixmac-runner-tahoe ghcr.io/darkmatter/nixmac-runner:tahoe
# =============================================================================

variable "bun_version" {
  type        = string
  default     = "1.3.14"
  description = "Bun version to bake (must match package.json packageManager)."
}

variable "image_name" {
  type        = string
  default     = "nixmac-runner-tahoe"
  description = "Local tart VM name during build."
}

variable "cpu_count" {
  type        = number
  default     = 8
  description = "VM CPU count during build."
}

variable "memory_gb" {
  type        = number
  default     = 16
  description = "VM memory in GB during build."
}

variable "disk_size_gb" {
  type        = number
  default     = 100
  description = "VM disk size in GB (must accommodate base image + tools)."
}
variable "base_image" {
  type    = string
  default = "ghcr.io/cirruslabs/macos-tahoe-xcode:26.5"
}

variable "base_image_digest" {
  type    = string
  # Manifest digest for the 26.5 tag, resolved 2026-07-25.
  default = "sha256:61f6e857a3d65dd2f8daf9c51c7b837fa458bcc9181ae8556e645b534dab6bf6"
}

# SSH credentials for the base image (Cirrus Labs default).
variable "ssh_username" {
  type    = string
  default = "admin"
}

variable "ssh_password" {
  type    = string
  default = "admin"
  sensitive = true
}

packer {
  required_plugins {
    tart = {
      version = ">= 1.7.0"
      source  = "github.com/cirruslabs/tart"
    }
  }
}

source "tart-cli" "tart" {
  vm_name            = var.image_name
  vm_base_name       = "ghcr.io/cirruslabs/macos-tahoe-xcode@${var.base_image_digest}"
  cpu_count          = var.cpu_count
  memory_gb          = var.memory_gb
  disk_size_gb       = var.disk_size_gb
  ssh_username       = var.ssh_username
  ssh_password       = var.ssh_password
  ssh_timeout        = "30m"
  headless           = true
}

build {
  sources = ["source.tart-cli.tart"]

  # ---- Disable Spotlight indexing (saves CPU + disk during build) -----------
  provisioner "shell" {
    inline = [
      "sudo mdutil -a -i off",
      "sudo mdutil -a -E",
    ]
  }

  # ---- Determinate Nix (multi-user, no init system) -------------------------
  # Mirrors the Linux CI image's Nix install. --init none: no launchd service;
  # the runner starts nix-daemon via launchd plist if needed.
  provisioner "shell" {
    inline = [
      "curl -fsSL https://install.determinate.systems/nix | sh -s -- install darwin --init none --extra-conf 'trusted-users = root admin' --extra-conf 'max-jobs = 4' --no-confirm",
    ]
  }

  # ---- Nix packages + binary cache config -----------------------------------
  # Public binary caches only (pull). No auth tokens.
  # Each provisioner is a separate SSH session; nix-daemon is started inline.
  provisioner "shell" {
    inline = [
      "export PATH=/nix/var/nix/profiles/default/bin:$HOME/.nix-profile/bin:$PATH",
      "nix-daemon &>/tmp/nix-daemon.log & sleep 3",
      "nix profile install nixpkgs#cachix nixpkgs#sops nixpkgs#age nixpkgs#nodejs_22 nixpkgs#treefmt nixpkgs#nixfmt",
      # Configure binary caches (public keys fetched from cachix API; no auth)
      "cachix use darkmatter",
      "cachix use devenv",
      "cachix use nixpkgs-python",
      # Verify
      "nix --version && cachix --version && sops --version && age --version && node --version && treefmt --version && nixfmt --version",
      "pkill nix-daemon 2>/dev/null || true",
    ]
  }

  # ---- Bun ------------------------------------------------------------------
  # Version pinned to match package.json packageManager field.
  # macOS arm64 build.
  provisioner "shell" {
    inline = [
      "BUN_TAG='bun-v${var.bun_version}'",
      "curl -fsSL \"https://github.com/oven-sh/bun/releases/download/$BUN_TAG/bun-darwin-arm64.zip\" -o /tmp/bun.zip",
      "unzip -q /tmp/bun.zip -d /tmp/bun",
      "sudo mv /tmp/bun/bun-darwin-arm64/bun /usr/local/bin/bun",
      "sudo chmod +x /usr/local/bin/bun",
      "rm -rf /tmp/bun /tmp/bun.zip",
      "bun --version",
    ]
  }

  # ---- Shell profile (PATH for runner user) ---------------------------------
  # Ensure /nix/var/nix/profiles/default/bin and /usr/local/bin are on PATH
  # for all login shells. The GitHub Actions runner uses the admin user.
  provisioner "shell" {
    inline = [
      "grep -q 'nix/var/nix/profiles/default/bin' ~/.zprofile 2>/dev/null || echo 'export PATH=/nix/var/nix/profiles/default/bin:$HOME/.nix-profile/bin:/usr/local/bin:$PATH' >> ~/.zprofile",
      "grep -q 'nix/var/nix/profiles/default/bin' ~/.zshrc 2>/dev/null || echo 'export PATH=/nix/var/nix/profiles/default/bin:$HOME/.nix-profile/bin:/usr/local/bin:$PATH' >> ~/.zshrc",
    ]
  }

  # ---- Clean up -------------------------------------------------------------
  provisioner "shell" {
    inline = [
      "sudo rm -rf /private/var/folders/* /tmp/* /var/tmp/*",
      "sudo purge 2>/dev/null || true",
    ]
  }
}
