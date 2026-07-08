# ADR 0006: Config Tiers And Secret Boundaries

Status: proposed for team review

## Context

Slack thread `1782522759.331799`, `.cursor/rules/native-config-tiers.mdc`, and
meeting notes all point to the same split: build profiles, user preferences,
repo-scoped project settings, and encrypted secrets each have distinct owners.

## Decision

Every config value must fit exactly one tier:

- Build profile: `apps/native/env.development.json`, `env.release.json`, or
  `env.e2e.json`, read through `apps/native/src/lib/env.ts`.
- User preference: Tauri app data persistence via `global-preferences.json`.
- Project setting: `<config_dir>/.nixmac/settings.json`.
- Secret: credential store/keychain or encrypted `ops/secrets/secrets.sops.json`.

Do not invent ad hoc config files or read arbitrary `process.env` /
`import.meta.env` values outside `env.ts`; direct `import.meta.env.DEV` checks
are the narrow exception.

## Consequences

- App-local `.nixmac/settings.json` is app metadata, not user-desired config
  drift.
- API keys and secrets do not go through JSON preference export/import.
- Secret scanners need allowlists for intentional secret-looking fixtures and
  config.
