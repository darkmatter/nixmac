# =============================================================================
# nixmac Computer Use E2E image (macOS / Tahoe)
#
# This is a thin, immutable layer over the already-qualified nixmac Xcode
# runner. It deliberately does not install Xcode, Nix, source code, GitHub
# credentials, or host attestation keys.
#
# Pinned CuaDriver identity:
#   release: cua-driver-rs-v0.12.6
#   archive: c64017d5878d022df34137082fb918ae0d4304e28890569ff14458f1a54fd361
#   app executable: eae725a09e0cdbda4bb37058a0393b86f7c97b5dda3769a10b1d79269ba8b334
#   app tree: 9b702de4f1591a59428f01e76eceab5a11552d19c26329eef75f0669ddc44da0
#   bundle: com.trycua.driver
#   signer team: YCK386LBJ7
#   app: /Applications/CuaDriver.app
#   CLI symlink: /usr/local/bin/cua-driver
#
# TCC is granted only to the signed app bundle for Accessibility and
# ScreenCapture. Runtime qualification proves the grants on first and aged
# boots before the image can be promoted.
# =============================================================================

variable "image_name" {
  type    = string
  default = "nixmac-e2e-runner-tahoe"
}

variable "source_image" {
  type        = string
  description = "Qualified GHCR repository for the nixmac Xcode runner."

  validation {
    condition     = can(regex("^ghcr\\.io/[a-z0-9._/-]+$", var.source_image))
    error_message = "Source_image must be a lowercase GHCR repository without a tag or digest."
  }
}

variable "source_image_digest" {
  type        = string
  description = "Immutable digest of the qualified Xcode base image."

  validation {
    condition     = can(regex("^sha256:[0-9a-f]{64}$", var.source_image_digest))
    error_message = "Source_image_digest must be a sha256 manifest digest."
  }
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

source "tart-cli" "e2e" {
  vm_name      = var.image_name
  vm_base_name = "${var.source_image}@${var.source_image_digest}"
  cpu_count    = 8
  memory_gb    = 16
  disk_size_gb = 160
  ssh_username = var.ssh_username
  ssh_password = var.ssh_password
  ssh_timeout  = "30m"
  headless     = true
}

build {
  sources = ["source.tart-cli.e2e"]

  provisioner "file" {
    source      = "provision-nixmac-e2e-runner.sh"
    destination = "/tmp/provision-nixmac-e2e-runner.sh"
  }

  provisioner "file" {
    source      = "qualify-nixmac-e2e-runner.sh"
    destination = "/tmp/qualify-nixmac-e2e-runner.sh"
  }

  provisioner "file" {
    source      = "refresh-nixmac-e2e-runner.sh"
    destination = "/tmp/refresh-nixmac-e2e-runner.sh"
  }

  provisioner "shell" {
    inline = [
      "set -euo pipefail",
      "chmod 700 /tmp/provision-nixmac-e2e-runner.sh /tmp/qualify-nixmac-e2e-runner.sh /tmp/refresh-nixmac-e2e-runner.sh",
      "sudo /bin/bash /tmp/provision-nixmac-e2e-runner.sh",
      "sudo install -o root -g wheel -m 0755 /tmp/qualify-nixmac-e2e-runner.sh /usr/local/libexec/qualify-nixmac-e2e-runner",
      "sudo install -o root -g wheel -m 0755 /tmp/refresh-nixmac-e2e-runner.sh /usr/local/libexec/refresh-nixmac-e2e-runner",
      "sudo rm -f /tmp/provision-nixmac-e2e-runner.sh /tmp/qualify-nixmac-e2e-runner.sh /tmp/refresh-nixmac-e2e-runner.sh",
    ]
  }
}
