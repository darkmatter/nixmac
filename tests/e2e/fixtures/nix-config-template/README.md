# nix-darwin-determinate

## Description

This template is the result of running the nix-darwin "from scratch" instructions found at https://github.com/nix-darwin/nix-darwin?tab=readme-ov-file#step-1-creating-flakenix plus some small changes for Determinate. Enhanced with Touch ID sudo and modular AI-friendly structure.

## sops-nix secrets quick start

This template includes `sops-nix` by default with minimal base wiring:

- [flake.nix](flake.nix): `sops-nix` input and darwin module are enabled
- [modules/darwin/sops.nix](modules/darwin/sops.nix): minimal base `sops` configuration
- [modules/darwin/sops-secrets.nix](modules/darwin/sops-secrets.nix): secret declarations and runtime bindings
- [.sops.yaml](.sops.yaml): creation rules for `secrets/*.yaml`

To start using secrets:

1. Replace `AGE_PUBLIC_KEY_PLACEHOLDER` in [.sops.yaml](.sops.yaml) with your age public key.
1. Add your secret entries in [modules/darwin/sops-secrets.nix](modules/darwin/sops-secrets.nix).
1. Create/edit encrypted secrets with `sops secrets/<name>.yaml`.
