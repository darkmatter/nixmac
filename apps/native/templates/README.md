# Templates

This directory contains some starter and notable templates.

## nixos-unified Template

`nixos-unified` is a cross-platform flake template (Linux + macOS) based on
[`juspay/nixos-unified-template`](https://github.com/juspay/nixos-unified-template).
It is useful for testing flake workflows on Linux CI while still supporting
`nix-darwin` and `home-manager` on macOS.

## nix-darwin-determinate Template

`nix-darwin-determinate` is the current bootstrap template used by nixmac for
macOS-first onboarding.

## Base Template

The base template is what every installation of Nixmac starts with and must contain. If it's ever updated, then that update should be deployed to
all installs.

The base modules should never have any other code put into them, and their integrity must be tracked
using a checksum in order to verify that an installation has the expected base files.
