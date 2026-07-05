# Templates

This directory contains some starter and notable templates.

## Custom remote templates

Besides the bundled templates below, onboarding's "Start from scratch" accepts
a **custom template** from any git repository — `owner/repo`,
`github:owner/repo`, full git URLs, with optional `?ref=<branch-or-tag>` and
`?dir=<subdirectory>` (e.g. `github:owner/repo?dir=templates/mac`). Private
GitHub repos work through the GitHub App connection.

Template semantics differ deliberately from *imports* ("I already have a
flake"): the referenced directory's files are **copied** into a fresh config
dir with a brand-new git history (single initial commit, tagged
`nixmac-base-<hash>`) — the template's own `.git` history and origin are never
inherited. The referenced directory must contain a `flake.nix`.

Conventions for template authors:

- Remote templates are processed as **nixmac templates**, not arbitrary
  flakes. In `.nix` file *contents*, `HOSTNAME_PLACEHOLDER`,
  `PLATFORM_PLACEHOLDER`, and `USERNAME_PLACEHOLDER` are substituted with the
  chosen machine name, `aarch64-darwin`/`x86_64-darwin`, and the macOS
  username. In **file and directory names**, `{{hostname}}` and the same
  placeholder tokens are substituted for *every* file, not just `.nix` ones.
- Using the hostname placeholder implies the convention that
  `darwinConfigurations.HOSTNAME_PLACEHOLDER` names the machine's
  configuration: nixmac then selects the chosen machine name as the host
  automatically, exactly like the bundled templates. Templates that skip the
  placeholder work too — nixmac instead asks the user to pick among the
  template's actual `darwinConfigurations` hosts.
- Symlinks are **skipped** (with a warning) — don't rely on them.
- `.git` and `.DS_Store` entries are never copied.
- A shipped `flake.lock` is kept and committed, pinning the template author's
  inputs; `nix flake lock` only rewrites it when incomplete.

Known limitation: the repository is fully cloned (no shallow clone, no
progress UI), so huge repositories make poor templates.

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

## .nixmac Modules

Every template includes a `.nixmac` directory for official Nixmac modules. Each
module uses `.nixmac/<module>/{default.nix,meta.json,data.json}` so Nix
implementation stays separate from user-controlled data. Agents must only edit
`data.json`; `default.nix` and `meta.json` are reserved for Nixmac-managed
upgrades and future extension metadata.
