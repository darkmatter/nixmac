# Security

nixmac handles local machine configuration, credentials, SOPS files, and user
repositories. Security work should be practical and specific.

## Non-Negotiables

- Do not log plaintext secrets.
- Do not commit plaintext secrets.
- Do not hand-edit encrypted secret files.
- Do not read or mutate production secrets while doing local docs/code work.
- Do not run prod deploys or release workflows unless explicitly asked.
- Use path-safe helpers for files under the user's config directory.
- External commands launched from the app must use the app's Nix-aware PATH
  helper, not an assumed shell environment.
- Do not interpolate user-controlled paths, URLs, branch refs, or command
  fragments into privileged shell scripts. Prefer argument APIs; otherwise use
  shell-literal escaping at the boundary.
- Reject ambiguous GitHub URL and SSH path shapes before token minting, clone
  auth, or materialization. Parser acceptance is not enough if the downstream
  auth or filesystem step can reinterpret the value.
- Do not copy raw keys, tokens, or plaintext secret snippets from Slack,
  Granola, logs, Sentry, or local shell output into docs, tests, snapshots, PR
  comments, or telemetry.

## Secret-Looking Values

The repo may intentionally contain values that look like secrets. A scanner or
pre-commit hook must include an allowlist strategy and should be validated
against existing fixtures/config before becoming required.

## User Config Safety

- User config paths must remain inside the selected config directory.
- For repo imports or containment-sensitive paths, follow
  [../AGENTS.md](../AGENTS.md#high-risk-routing) before choosing the
  enforcement point or fixtures.
- Nix edits should be semantic and surgical.
- Rollback and discard paths must protect unrelated user changes.
- Imports should not treat app-local `.nixmac/settings.json` as drift to be
  committed into the user's desired config output.
- Distinguish nixmac operational API keys from user-managed Nix secrets. Do not
  route both through the same product surface just because both are "secrets."
- Keep Sentry DSNs, feedback submission DSNs, and device API keys separate.
  A public feedback DSN is a routing guard, not authentication and not a secret.
- If a user-secret flow intentionally opens plaintext in `$EDITOR`, preserve the
  risk-reduction intent unless a product decision replaces that flow.
- Secure-storage proposals must match the data flow. If a value must be
  materialized as plaintext for an outbound HTTP request, enclave-style storage
  alone does not solve exposure.

## Review Checklist

When touching security-sensitive code, reviewers should check:

- Could user input escape the config directory?
- Could a secret be printed to logs, Slack, GitHub, Sentry, or test snapshots?
- Could local dev accidentally use prod defaults?
- Could a CI artifact or release build be unsigned, mis-signed, or unverifiable?
- Does the code fail closed with a useful diagnostic?
- Are redaction rules still useful for debugging, or did they remove the only
  information needed to diagnose a failed evolve/build/provider path?
