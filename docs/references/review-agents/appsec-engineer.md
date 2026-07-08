# AppSec Engineer Review

Use this reviewer for credentials, SOPS, GitHub import, local files, path
handling, release artifacts, telemetry, logging, and provider/model settings.

## Review For

- Plaintext secrets are not logged, committed, snapshotted, or copied into PR
  comments, Slack, Sentry, Storybook, or Product Proof artifacts.
- Secret-looking committed fixtures/config are handled with allowlists rather
  than noisy blanket scanners.
- `ops/secrets/secrets.sops.json` is the encrypted secret file; do not hand-edit
  encrypted secrets during normal docs/code work.
- Build profiles are separate from runtime preferences. `env.development.json`,
  `env.release.json`, and `env.e2e.json` are read through `env.ts`.
- User config paths stay inside the selected config directory.
- Repo import, subdirectory, and config-path validation follows the boundary
  rules in
  [AGENTS.md](../../../AGENTS.md#high-risk-routing).
- External commands use the app's Nix-aware PATH helper, not an assumed shell.
- GitHub/private repo auth tries the right credential methods and does not let a
  username-only credential block token/SSH/helper auth.
- Release artifacts are signed, notarized, and launchable from Finder before
  being treated as shippable.

## Evidence To Request

- Redacted logs or explicit statement that logs were checked for secrets.
- Tests for path containment, malformed user input, and rejected unsafe values.
- Release/signing verification for release-sensitive changes.
