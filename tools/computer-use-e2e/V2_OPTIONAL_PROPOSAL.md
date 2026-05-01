# Computer Use E2E Optional V2 Proposal

## Scope Boundary

This work stays inside the Computer Use E2E/testing-suite feature branch. It
does not change nixmac product code, Tauri commands, UI behavior, provider
behavior, app accessibility labels, or app configuration semantics.

## Recommendation

Add model-critic artifacts and the smallest useful model-selection benchmark in
this branch. Do not add invalid-key/provider-edge lanes or external-config
mutation lanes yet. Do not do a full scenario-registry refactor yet.

The model critic is advisory. It cannot flip deterministic pass/fail. Its job is
to answer reviewer questions that the deterministic runner intentionally does
not answer well:

- Does the report overclaim what the evidence proves?
- Are there hidden coverage or cleanup risks a reviewer should inspect?
- Is the failure taxonomy plausible?
- Is the PR focus section actually aligned to the changed files?
- Are screenshots/text/remote metadata sufficient for a human review pass?

## Why This Fits This Branch

The current feature already publishes a reviewer-facing HTML evidence product.
An advisory critic belongs in that product because it improves review speed and
reviewer trust without increasing app blast radius.

The other deferred V2 items are less appropriate for this PR:

- Invalid-key/provider-edge workflows mutate credentials and launchd state. They
  need tighter isolation and probably a separate PR after the base lane is
  accepted.
- External-config mutation lanes intentionally dirty the disposable config tree.
  They should wait until the rollback contract has run in production for a few
  PRs.
- A full scenario-registry module is good cleanup, but it is not the highest
  product risk right now. This branch can add a read-only exported snapshot of
  the existing scenario contracts if needed, then leave full consolidation for a
  follow-up.

## Model Selection Strategy

Use OpenRouter because the E2E workflow already receives
`NIXMAC_E2E_OPENROUTER_API_KEY` / `OPENROUTER_API_KEY`. Current OpenRouter model
availability shows several good candidates:

- `openai/gpt-5.4-mini`: fast default candidate with strong structured-output
  behavior.
- `anthropic/claude-sonnet-4.6`: strong review-oriented candidate.
- `google/gemini-3-flash-preview`: fast cross-family candidate.
- `x-ai/grok-4.3`: broad reasoning candidate.
- `openai/gpt-5.4`: slower tie-breaker candidate when the fast critic is
  uncertain.

The default PR path should run one fast critic. A second model should run only
when the first model reports low confidence, finds a blocker, or the deterministic
report is non-pass. This keeps latency low without hiding serious issues.

Initial default:

- primary critic: `openai/gpt-5.4-mini`
- escalation critic: `openai/gpt-5.4`

If the benchmark shows another model is statistically non-inferior and faster,
the default should change.

## Data-Driven Benchmark

Add `tools/computer-use-e2e/run-model-critics.mjs` with two modes:

- `benchmark`: run candidate models against a labeled fixture set.
- `review`: run the selected critic against one generated E2E run directory.

Benchmark fixtures should come from existing E2E/adversarial artifacts, not
synthetic-only prompts. The current adversarial suite already has 27 labeled
cases and a clean passing baseline. The benchmark should convert those into
compact critic prompts with expected outcomes:

- clean pass should be accepted;
- false-green, missing evidence, sensitive leak, missing rollback proof,
  coverage drift, weak evidence, bad taxonomy, and bad visual assertions should
  be flagged;
- provider/credential/remote-infra failures should be classified without
  calling them app regressions.

Metrics:

- accuracy;
- precision/recall for `flag`;
- taxonomy accuracy where a failure class is expected;
- mean and p95 latency;
- malformed JSON rate;
- abstention/low-confidence rate.

Statistical defense:

- Use Wilson 95% confidence intervals for accuracy and recall.
- Use paired sign/McNemar-style comparison for model disagreements on the same
  fixtures.
- Treat models as tied when intervals overlap and paired disagreement is not
  significant at `p < 0.05`.
- Among statistically tied models, choose the faster model by p95 latency.

This is intentionally honest about sample size. A 28-case fixture set cannot
prove small differences, but it can detect obvious regressions and justify
"fastest non-inferior" model choice. The benchmark output should say when there
is no statistically significant winner.

## Report Integration

When enabled, `review` writes:

```text
model-critic/model-critic.json
model-critic/model-critic.md
```

The HTML report should render a collapsed "Model Critic" section below
deterministic findings and evidence quality. The top summary can show a small
advisory badge:

- `not-run`
- `clean`
- `advisory`
- `needs-review`

The report copy must be explicit:

- deterministic pass/fail remains source of truth;
- model critics are advisory;
- critic output is generated from redacted report evidence;
- critic output cannot override screenshot signal checks, remote git proof, or
  scenario statuses.

## CI Behavior

Keep model critics opt-in at first:

```text
NIXMAC_E2E_MODEL_CRITIC=true
NIXMAC_E2E_MODEL_CRITIC_MODEL=openai/gpt-5.4-mini
NIXMAC_E2E_MODEL_CRITIC_ESCALATION_MODEL=openai/gpt-5.4
```

If `NIXMAC_E2E_MODEL_CRITIC=true` and the OpenRouter key is missing, render
`not-run` instead of failing the E2E check. The deterministic suite should not
become unavailable because an advisory model-review layer could not run.

## Acceptance Criteria

- `run-model-critics.mjs benchmark` works from existing adversarial artifacts
  and writes `summary.json`/`index.html`.
- `run-model-critics.mjs review --run-dir <run>` writes redacted critic
  artifacts without raw secrets.
- `run-remote-cua.mjs` embeds critic artifacts when present.
- The PR report clearly labels model output as advisory.
- The existing remote E2E pass/fail mechanism remains deterministic.
- Local validation covers syntax, self-test, render-existing, adversarial
  validation, and at least one live OpenRouter critic smoke test when a key is
  available.
