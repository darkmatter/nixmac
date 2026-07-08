# Core Beliefs

- `main` is the current trunk. Treat `develop` as historical unless the task
  explicitly targets it.
- Tags and release artifacts carry release identity; notarization/build proof
  should stay separable from publishing.
- Git is the source of truth for review/save/discard/rollback.
- oRPC, generated bindings, and React Query are the default Rust-to-UI path.
- Config values belong to one tier: build profile, user preference, or project
  setting.
- Semantic Nix edits should preserve user intent.
- Feedback DSNs, Sentry DSNs, and device API keys are separate contracts.
- Product Proof is advisory until refreshed.
- Storybook is a frontend harness, not native Mac proof.
