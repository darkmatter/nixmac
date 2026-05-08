# nixmac E2E Dual-Lane Strategy

## TL;DR

nixmac should keep two desktop E2E lanes:

- **Computer Use Product Proof** is the broad reviewer-facing lane for PR evidence, release/high-risk workflows, and real UI interaction inside the running app.
- **Peekaboo AX/screen-capture E2E** is a complementary Mac proof lane for fast deterministic launch/readiness checks, screenshots, shell-owned fixture/state checks, Nix/system boundaries, MacInCloud health, and focused smoke tests.

Peekaboo should not be treated as a full replacement for Computer Use. It can show where its evidence corresponds to Computer Use coverage, but missing Computer Use breadth is not itself a Peekaboo failure.

## Why Parity Was Not Reached

The gap was not mainly scenario count. More scenarios would have increased breadth, but would not have fixed the core interaction boundary.

Computer Use can operate through a higher-level app-server interaction path that proved broad user workflows in PR #75: launch, settings, history, console, feedback/report dialogs, suggestion cards, typed prompt submission, Review/Summary/Diff/Build boundaries, save/rollback, and discard boundaries.

Peekaboo runs through macOS screen capture, Accessibility (AX), coordinates, keyboard/paste, shell fixtures, and report artifacts. Those are excellent for deterministic Mac evidence, but on MacInCloud they did not expose the same reliable interaction surface for WebKit/React prompt controls.

The decisive checks were:

- An SSH-launched Swift AX probe against the running app reported `AX_TRUSTED=false`, `NODE_COUNT=1`, and zero matches for `evolve-prompt-input`, `Install vim`, `Add Rectangle`, `Describe changes`, `What to change`, or `Configuration change`.
- Peekaboo Bridge itself had Screen Recording and Accessibility permissions and could see the app generally, but the useful prompt/suggestion controls were not addressable through the trusted Peekaboo AX scan in the failure state.
- The focused MacInCloud `macos_core_product_proof` run reached the visible suggestion target, ran coordinate and paste/type fallbacks, then failed because the prompt state did not update: `Suggestion text did not reach the prompt after system input fallback`.

PR #105 also explored an app-owned WebKit eval bridge. That is useful, but it is a different proof class. It can prove React/app-level behavior when explicitly enabled, but it does not prove host pointer/compositor behavior such as pointerdown, mousedown, hover, touch, focus transfer, or real OS click delivery. A bridge-backed result should therefore be labeled separately from a Computer Use pass.

The defensible conclusion is narrower than “Peekaboo cannot test nixmac.” Peekaboo can test important nixmac behavior. It just cannot honestly claim full Computer Use parity on the current MacInCloud stack without a materially different trusted driver.

## When To Use Each Lane

Use **Computer Use Product Proof** when the question is:

- Can a reviewer trust that the real user workflow works?
- Did a PR change app UI, app state flow, provider flow, save/rollback, discard, or prompt interaction?
- Do we need broad Product Proof evidence linked from a PR comment?
- Do we need screenshot/video/report evidence from the same lane that drove the interaction?

Use **Peekaboo AX/screen-capture E2E** when the question is:

- Does the app launch and reach a stable shell on a real Mac?
- Is MacInCloud healthy enough for GUI capture and app staging?
- Are screenshots, diagnostics, report structure, and visual proof quality intact?
- Do shell-owned fixtures, Nix install/state boundaries, cleanup, and non-destructive smoke tests behave deterministically?
- Do we need a faster local or remote smoke check before spending Computer Use time?

Use **both** for high-risk desktop work: Peekaboo catches Mac/fixture/report regressions cheaply; Computer Use remains the broad user-workflow proof.

## Reporting Policy

Peekaboo reports should use **Computer Use correspondence**, not “Computer Use parity,” for mapped keys.

- A mapped key means Peekaboo evidence corresponds to part of the Computer Use coverage model.
- An unmapped key means that behavior is outside the current Peekaboo lane, not automatically a failed Peekaboo run.
- A Peekaboo run should fail for failed Peekaboo-owned evidence: app launch, scenario assertions, screenshots, diagnostics, secret scan, cleanup, report generation, or explicit lane-specific checks.
- A Peekaboo run should not fail solely because it does not cover every Computer Use Product Proof key.

## Repo Hygiene

Current state after the pivot decision:

- PR #75 is the merged Computer Use Product Proof baseline.
- PR #90 introduced the Peekaboo local Product Proof lane.
- PR #101 hardened Peekaboo boot diagnostics.
- PR #105 is an open follow-up experiment that tried to close the MacInCloud interaction gap and still failed the key prompt interaction criterion.

The PR #105 experiment should be preserved as evidence, but not merged as the new direction unless specific pieces are intentionally salvaged in smaller follow-ups. The go-forward policy belongs in a clean branch so reviewers do not have to separate a strategy decision from a large experimental diagnostic stack.

Salvage candidates from PR #105 should be evaluated individually:

- Keep if they improve lane-specific evidence without implying Computer Use parity.
- Keep if they produce clearer visual/report diagnostics.
- Keep bridge-backed behavior only with explicit wording that it proves app/React behavior, not host pointer/compositor parity.
- Drop or defer changes whose only purpose is to force Peekaboo into full Computer Use replacement semantics.

## Revisit Criteria

Revisit “Peekaboo can replace Computer Use” only if the driver changes materially:

- a trusted helper lives inside the already-granted Peekaboo Bridge or equivalent signed/granted process;
- the driver can address WebKit controls reliably in the same states Computer Use covers;
- text/click actions update app state through the same user-observable path the product depends on;
- report evidence distinguishes app-level synthetic proof from real host pointer/compositor proof.

Until then, the right product is a dual-lane system: Computer Use for broad workflow confidence, Peekaboo for fast deterministic Mac proof and complementary evidence.
