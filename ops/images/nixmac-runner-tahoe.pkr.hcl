# =============================================================================
# nixmac CI image (macOS / Tahoe)
#
# Minimal image design:
#   ghcr.io/cirruslabs/macos-tahoe-base@<pinned digest>
#   + one supplied Xcode 26.x artifact
#
# Nix, devenv, Bun, Rust, Cargo, and node_modules are intentionally NOT baked
# here. The existing CI setup uses public/remote caches for those artifacts;
# keeping them remote avoids a large image and keeps lockfile changes out of
# the base-image lifecycle.
#
# SECURITY: all inputs except the supplied Xcode artifact are public. No
# SOPS_AGE_KEY, Cachix auth, Apple signing keys, or API keys are provisioned.
# The workflow scans provisioning-owned text paths before pushing.
# =============================================================================

variable "image_name" {
  type        = string
  default     = "nixmac-runner-tahoe"
  description = "Local tart VM name during build."
}

variable "cpu_count" {
  type    = number
  default = 8
}

variable "memory_gb" {
  type    = number
  default = 16
}

variable "disk_size_gb" {
  type        = number
  default     = 140
  description = "Sparse VM disk capacity; measure physical/OCI usage after build."
}

# Documentation tag plus immutable manifest digest. The tag is not used as the
# source reference; update the digest when changing the base image.
variable "base_image_tag" {
  type    = string
  default = "ghcr.io/cirruslabs/macos-tahoe-base:latest"
}

variable "base_image_digest" {
  type        = string
  default     = ""
  description = "Required immutable manifest digest for the documented base tag."

  validation {
    condition     = can(regex("^sha256:[0-9a-f]{64}$", var.base_image_digest))
    error_message = "Base image digest must be a sha256 manifest digest."
  }
}

# Required local path on the dedicated image-builder host. This is supplied
# by the operator; it is not stored in the repository or in image layers.
variable "xcode_artifact" {
  type        = string
  default     = ""
  description = "Local path to the approved Xcode 26.x .xip or .pkg artifact."
}

variable "xcode_artifact_type" {
  type        = string
  default     = "xip"
  description = "Artifact extension: xip or pkg."
}

variable "ssh_username" {
  type    = string
  default = "admin"
}

variable "ssh_password" {
  type      = string
  default   = "admin"
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
  vm_name      = var.image_name
  vm_base_name = "ghcr.io/cirruslabs/macos-tahoe-base@${var.base_image_digest}"
  cpu_count    = var.cpu_count
  memory_gb    = var.memory_gb
  disk_size_gb = var.disk_size_gb
  ssh_username = var.ssh_username
  ssh_password = var.ssh_password
  ssh_timeout  = "30m"
  headless     = true
}

build {
  sources = ["source.tart-cli.tart"]

  # Keep the image build deterministic and avoid indexing the large Xcode tree.
  provisioner "shell" {
    inline = [
      "sudo mdutil -a -i off",
      "sudo mdutil -a -E",
    ]
  }

  # Xcode is the only large toolchain baked into this image. The artifact is
  # uploaded directly by Packer and removed after installation.
  provisioner "file" {
    source      = var.xcode_artifact
    destination = "/tmp/Xcode-artifact.${var.xcode_artifact_type}"
  }

  provisioner "shell" {
    inline = [
      "set -euo pipefail",
      "rm -rf /tmp/xcode-expanded /tmp/Xcode.app /Applications/Xcode.app",
      "mkdir -p /tmp/xcode-expanded",
      "case /tmp/Xcode-artifact.${var.xcode_artifact_type} in *.xip) cd /tmp/xcode-expanded && xip --expand /tmp/Xcode-artifact.${var.xcode_artifact_type} ;; *.pkg) sudo installer -pkg /tmp/Xcode-artifact.${var.xcode_artifact_type} -target / ;; *) echo 'Unsupported Xcode artifact; use .xip or .pkg' >&2; exit 1 ;; esac",
      # Delete the .xip before copying to avoid peak disk = .xip + expanded + copy.
      "rm -f /tmp/Xcode-artifact.${var.xcode_artifact_type}",
      "if [ -d /tmp/xcode-expanded/Xcode.app ]; then sudo mv /tmp/xcode-expanded/Xcode.app /Applications/Xcode.app; fi",
      "for xcode_app in /Applications/Xcode_*.app; do if [ -d \"$xcode_app\" ]; then sudo mv \"$xcode_app\" /Applications/Xcode.app; break; fi; done",
      "test -x /Applications/Xcode.app/Contents/Developer/usr/bin/xcodebuild",
      "sudo xcode-select -s /Applications/Xcode.app/Contents/Developer",
      "sudo xcodebuild -license accept",
      "sudo xcodebuild -runFirstLaunch",
      "xcodebuild -version",
      "xcrun --sdk macosx --show-sdk-path",
      "rm -rf /tmp/xcode-expanded /tmp/Xcode.app",
      "test ! -e /tmp/Xcode-artifact.${var.xcode_artifact_type}",
      "test ! -e /tmp/xcode-expanded",
    ]
  }

  # Cilicon 2.4.2's Citadel/SwiftNIO SSH library fails against OpenSSH 10.2
  # when ETM-only MACs are negotiated. Restrict the server to non-ETM MACs
  # so Cilicon's SSH client can complete the handshake. See upstream
  # swift-nio-ssh issue #243 for the algorithm negotiation failure.
  provisioner "shell" {
    inline = [
      "set -euo pipefail",
      "sudo mkdir -p /etc/ssh/sshd_config.d",
      "echo 'MACs hmac-sha2-256,hmac-sha2-512' | sudo tee /etc/ssh/sshd_config.d/99-cilicon-compat.conf",
      "sudo sshd -t",
    ]
  }

  # The pinned Cirrus base installs and configures Tart's guest agent. Verify
  # that invariant instead of downloading a floating release or silently
  # publishing an image without the expected host/guest integration.
  provisioner "shell" {
    inline = [
      "set -euo pipefail",
      "test -x /opt/homebrew/bin/tart-guest-agent",
      "test -f /Library/LaunchDaemons/org.cirruslabs.tart-guest-daemon.plist",
      "test -f /Library/LaunchAgents/org.cirruslabs.tart-guest-agent.plist",
    ]
  }

  # Remove installer residue. Do not attempt to delete Xcode platforms or
  # compaction-sensitive VM data here; measure the resulting Tart image first.
  provisioner "shell" {
    inline = [
      "sudo rm -rf /private/var/folders/* /tmp/* /var/tmp/* || true",
    ]
  }
}
