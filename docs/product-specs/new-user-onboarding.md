# Onboarding Domain

Onboarding is the highest-priority active product surface. It must work for a
fresh Mac and for a contributor importing an existing nix-darwin repo.

## Current Product Intent

The project milestone target is "zero to wow in under 8 minutes": a fresh Mac,
no Nix/Homebrew assumption, guided Nix install/onboarding/API key/setup, install
`ripgrep`, Dock autohide, and validation on macOS VMs.

Recent P1 onboarding snapshot, dated 2026-07-01. Linear/GitHub are the live
source of status; this list records current failure classes, not permanent
issue state.

- ENG-582 / GitHub #448: admin password prompts repeated around host display
  and onboarding disappearing into gated evolve UI.
- ENG-586 / GitHub #457: summary generator database lock.
- ENG-587 / GitHub #458: light-mode background polish.
- ENG-588 / GitHub #459: sign-up section displayed too early during first
  build.
- ENG-589 / GitHub #460: sidebar needs jump-ahead indication.
- Slack `1782868161.944739`: Import Flake back navigation, GitHub disconnect,
  non-root flakes, directory-exists recovery, Select Directory before flake
  selection, Import Customizations skippability/eval filtering, and Fix with AI
  affordance in logs.

Meeting decisions from 2026-06-30:

- Remove or strongly de-emphasize Import Customizations during onboarding; the
  feature belongs more prominently in the main app.
- Add a dedicated Select Config Directory step before flake selection.
- If the selected directory already has `flake.nix`, skip import-flake setup.
- AI engine setup should match Settings provider options.
- App Management permission and `/Applications` placement are real onboarding
  risks.

## Implementation Guidance

- Keep onboarding state explicit. Back/skip/continue should reset or preserve
  intermediate state intentionally.
- Keep checkbox state, expansion/collapse state, viewed-step state, and
  selected customization sources separate. Bugs in these transitions have been
  recurring PR-review friction.
- Do not surface the underlying evolve flow while onboarding is active unless
  the user has exited onboarding.
- Clone/import flows need destination directory, repo ref, selected host, and
  config dir to stay consistent.
- New fetchable onboarding data should use oRPC plus React Query hooks; shared
  onboarding client/view state belongs in `packages/state`.
- Storybook onboarding previews are useful for UI review but are not a substitute
  for app-level state and filesystem verification.
- Do not make app-local `.nixmac/settings.json` look like desired user config
  drift.
- If sign-up or provider setup can be skipped, ask again during natural wait
  states rather than blocking the first useful path.
- Directory import should handle GitHub HTTPS, SSH, `www.github.com`,
  subdirectory flakes, branch refs, `?ref=`, and `?dir=` without losing the
  selected target directory.
- Treat `?dir=` and selected subdirectory values as filesystem-boundary input,
  not just parser syntax. The import materializer must reject absolute paths,
  parent/current/empty components, platform prefixes, and symlink escapes before
  reading or copying from the checkout.
- Preserve the distinction between repository root, selected config/flake root,
  and destination directory. A fix that only parses the URL but reads from the
  wrong materialized path is not complete.
- Import retry/back paths should be idempotent. Stage clone/materialization work
  in a temporary location until the user commits to a destination, and clean up
  partial state when the user backs out or retries.
- If a repository has one plausible flake/config root, auto-select it only after
  preserving the repository-root/config-root/destination distinction. Ambiguous
  repositories still need an explicit choice.
- "Custom template repo" belongs with the start-from-scratch path, not as a
  mandatory import-customizations step for users who are still trying to get
  their existing config into the app.

## Verification

At minimum, test the state machine and parser logic with unit tests. For UI
changes, add or update Storybook stories. For import flows, include manual steps
for GitHub URL, SSH URL, `?ref=`, `?dir=`, non-root flake, and destination
directory behavior when applicable. For subdirectory import changes, add
negative tests for absolute paths, traversal, empty/current components, and
symlink escape at the materialization boundary. For retry/back changes, verify
that failed or abandoned imports do not leave partial checkout state in the
selected destination.
