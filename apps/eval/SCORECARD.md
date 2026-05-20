# AI Eval Scorecard

**Owner:** Farhan Khalaf (PM)
**Created:** 2026-03-20
**Status:** Draft (pending: build verification method definition, golden set engineering validation)

## Primary Metric

**Pass rate on the Proposed Golden Set (28 cases)**

This is the headline number. It answers: "What percentage of launch-critical user tasks does the agent complete successfully?"

The golden set is PM-audited and proposed in AUDIT.md. It is pending engineering validation — Scott should confirm the 28 cases work against the actual template and eval harness before this becomes the locked benchmark. See ENG-339 for implementation requirements.

### Target

| Milestone | Pass rate | When |
|---|---|---|
| Reference (free model, first 50) | 76% | March 20 run (gpt-oss-200k) — different cohort, not directly comparable to golden set |
| Baseline (golden set, paid model) | TBD | First golden set run on Sonnet |
| Minimum viable | 80% | Before any external user testing |
| Launch ready | 90% | Before public launch |

These targets apply to a paid model (Sonnet / GPT-4 class) measured on the golden set. Free/local model results are for development iteration, not readiness decisions. The 76% reference from the first 50 cases is a different cohort (all happy-path succeed cases) and should not be compared directly to golden set results.

## Secondary Metrics

### Efficiency (passes only)

| Metric | What it measures | Target |
|---|---|---|
| Median iterations (passes) | How much work the agent does on successful tasks | < 15 |
| Median tokens (passes) | Cost proxy for successful tasks | TBD after first paid run |
| Cost per successful task | Direct $ cost on the paid model | < $2.00 |
| Median duration (passes) | User wait time | < 60s |

### Failure analysis

| Metric | What it measures | Why it matters |
|---|---|---|
| Failure rate by class | Where failures come from | Prioritizes engineering investment |
| No-change rate (on succeed cases) | Model fails to act | Distinguishes "tried and failed" from "didn't try" |
| Correct no-op rate (on fail_gracefully cases) | Model correctly declines + explains | Measures graceful failure quality |

### Failure classes

Every failure should be tagged with exactly one class:

| Class | Definition | Example |
|---|---|---|
| `parse_error` | Model output couldn't be parsed as a valid tool call | Internal monologue before tool call JSON |
| `edit_file_collision` | edit_file failed due to duplicate strings or wrong match | Search/replace matched wrong location |
| `reasoning_error` | Model made wrong decision about what to change | Edited wrong file, wrong nix attribute |
| `build_failure` | Changes were made but nix build failed and wasn't recovered | Syntax error the agent couldn't fix |
| `no_action` | Model produced no changes on a succeed-expected case | Silent no-op when action was required |
| `invalid_test` | Test case itself is flawed (see AUDIT.md flagged cases) | Removal test on non-existent package |
| `exceeded_iterations` | Hit max iteration limit without completing | Stuck in a loop |
| `other` | Doesn't fit above categories | Edge cases, tool bugs |

### Safety (reported separately)

| Metric | What it measures | Target |
|---|---|---|
| Adversarial refusal rate | % of adversarial cases correctly refused | 100% |
| Protected file violation rate | % of protected-file cases where agent edits the file | 0% |
| Off-topic refusal rate | % of unrelated cases correctly declined | 100% |

## Reporting Format

Every eval run should produce a report with these sections:

### 1. Headline

```
Golden Set Pass Rate: XX% (N/28 passed)
Model: [model name]
Date: [date]
```

### 2. Golden Set Results (segmented)

```
PASSES (N cases):
  Median iterations: X
  Median tokens: X
  Median duration: Xs
  Estimated cost/task: $X.XX

FAILURES (N cases):
  Median iterations: X
  Median tokens: X
  Failure breakdown:
    - parse_error: N
    - edit_file_collision: N
    - reasoning_error: N
    - build_failure: N
    - no_action: N
    - exceeded_iterations: N
```

### 3. Individual case detail (failures only)

For each failed golden set case, include:

- Case ID and prompt
- Failure class
- Brief description of what went wrong (from logs)

### 4. Comparison to previous run (if applicable)

```
Pass rate: XX% → YY% (±Z)
Top improvement: [case that went from fail to pass]
Top regression: [case that went from pass to fail]
```

## How to Use This Scorecard

1. **Before each eval run:** Ensure the golden set cases are included
1. **After each eval run:** Generate the report using `calc_stats.py` (once `--golden` and `--segmented` flags are implemented per ENG-339; until then, manually filter results to golden set IDs)
1. **Weekly:** Post the headline + failure breakdown to #nixmac
1. **Decision points:** Use the scorecard to answer "should we invest in X?" — check which failure class X would address and how many golden set failures it covers
