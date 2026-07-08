# Config and Secrets Domain

Config and secret handling must protect users without breaking developer setup.
AI provider IDs, credential defaults, and model selection rules are covered in
[ai-providers.md](ai-providers.md). Keep these docs aligned when changing
provider storage or Settings copy.

## Config Tiers

Use the three-tier model from [../../ARCHITECTURE.md](../../ARCHITECTURE.md):

- Build profiles: `env.development.json`, `env.release.json`, `env.e2e.json`.
- User preferences: Tauri app data persistence via `global-preferences.json`.
- Project settings: `<config_dir>/.nixmac/settings.json`.

Do not add new config surfaces casually.

## Dev Environment Lessons

A June 26 developer setup incident showed two DX risks:

- Missing `ops/secrets/secrets.yaml` produced a restart loop, while Cooper
  clarified the actual encrypted file is `ops/secrets/secrets.sops.json`.
- Local development appeared to default toward prod via `NIXMAC_ENV`, which is
  wrong for a new contributor.

Agents should avoid assuming prod defaults for local work. Docs and errors
should tell a contributor exactly which profile/secret path is expected.

## Security Tooling Nuance

The repo intentionally contains some values that look secret-like. A generic
secret scanner will need allowlists or custom rules. Do not propose a scanner as
a silver bullet unless the false-positive strategy is part of the change.

## Secret Workflow

- Use SOPS for encrypted repo secrets.
- Do not edit encrypted secret files without SOPS.
- Do not log plaintext secret values.
- Use app credential storage for runtime user credentials.
- Prefer clear missing-secret errors over crash loops.

## Import And Migration

Config import is a product wedge, not a one-off scanner. Known sources such as
Homebrew, macOS defaults, and user-authored launch agents should use
deterministic detection and managed edits where possible. Reserve the evolve
agent for ambiguous mapping or user-requested changes.

Before writing an import:

- detect whether the current Nix config already tracks the setting through eval
  or a domain-specific source of truth;
- re-check the live missing/untracked set immediately before applying;
- preserve the user's existing file shape and comments;
- decide whether the fix helps only future templates or also remediates existing
  repos.

For Homebrew-specific import/adoption changes:

- verify scanner correctness before changing presentation: exact default-tap
  matching, trim/dedupe behavior, and the intended item classes should be
  covered in Rust tests or fixtures;
- route scanner output through one shared backend/UI projection instead of
  separate hardcoded lists in banners, cards, and stories;
- after applying an adoption action, refresh the live diff instead of trusting
  the pre-apply list.
