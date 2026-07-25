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
  type        = number
  default     = 8
}

variable "memory_gb" {
  type        = number
  default     = 16
}

variable "disk_size_gb" {
  type        = number
  default     = 100
  description = "VM disk size; measure physical usage after compaction."
}

# Documentation tag plus immutable manifest digest. The tag is not used as the
# source reference; update the digest when changing the base image.
variable "base_image_tag" {
  type    = string
  default = "ghcr.io/cirruslabs/macos-tahoe-base:latest"
}

variable "base_image_digest" {
  type    = string
  # Manifest digest resolved 2026-07-25 for macos-tahoe-base:latest.
  default = "sha256:a8e1c8305758643f513fdccdd829c2243687c60791083dea42f73f0b7aeb435c"
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
      "rm -rf /tmp/xcode-expanded /tmp/Xcode.app",
      "mkdir -p /tmp/xcode-expanded",
      "case /tmp/Xcode-artifact.${var.xcode_artifact_type} in *.xip) cd /tmp/xcode-expanded && xip --expand /tmp/Xcode-artifact.${var.xcode_artifact_type} ;; *.pkg) sudo installer -pkg /tmp/Xcode-artifact.${var.xcode_artifact_type} -target / ;; *) echo 'Unsupported Xcode artifact; use .xip or .pkg' >&2; exit 1 ;; esac",
      "if [ -d /tmp/xcode-expanded/Xcode.app ]; then sudo ditto /tmp/xcode-expanded/Xcode.app /Applications/Xcode.app; fi",
      "test -x /Applications/Xcode.app/Contents/Developer/usr/bin/xcodebuild",
      "sudo xcode-select -s /Applications/Xcode.app/Contents/Developer",
      "sudo xcodebuild -license accept",
      "sudo xcodebuild -runFirstLaunch",
      "xcodebuild -version",
      "xcrun --sdk macosx --show-sdk-path",
      "rm -rf /tmp/Xcode-artifact /tmp/xcode-expanded /tmp/Xcode.app",
    ]
  }

  # Remove installer residue. Do not attempt to delete Xcode platforms or
  # compaction-sensitive VM data here; measure the resulting Tart image first.
  provisioner "shell" {
    inline = [
      "sudo rm -rf /private/var/folders/* /tmp/* /var/tmp/*",
    ]
  }
}
