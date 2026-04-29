# macOS-First E2E Spike

This branch intentionally starts from `33938057`, before the broad product-journey
full-Mac companion work on PR 45. PR 45 and `fkb/e2e-gate-test-pr` are preserved
as-is; this branch is a smaller retry focused on making one real Mac proof stable
before adding breadth.

Initial target:

- launch the exact-SHA `/Applications/nixmac.app` on the self-hosted Mac;
- record at 30 fps;
- type one descriptor into the main prompt;
- prove the prompt path reaches the expected local provider-validation block;
- publish the video as the primary report proof.

Do not port the broad full-Mac companion suite into this branch until the first
scenario is stable across repeated workflow runs.
