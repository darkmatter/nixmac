# ADR 0003: Main Is Current Trunk, Release Policy Remains Decision Debt

Status: proposed for team review

## Context

Farhan clarified on 2026-07-07 that nixmac no longer uses `develop` as trunk.
Local git evidence also reports `origin/HEAD` as `refs/remotes/origin/main`.
The remote branch `origin/develop` still exists, and some historical docs or CI
comments may still mention it, but agents should not infer current trunk from
those stale references.

Slack `#nixmac` on 2026-07-02 also converged on the same shape: `main` is the
working branch, release identity comes from tags and release artifacts, and
notarization/build proof should be separable from publishing a tagged release.

Linear ENG-454 remains historical decision context for release/update policy,
workflow filters, tags, and merge queue behavior.

## Decision

Document current reality as `main` being the working trunk for agents and PRs.
Do not treat `develop` as current trunk unless the user explicitly says a task
targets that branch.

Keep trunk guidance separate from release publishing policy. Tags and release
artifacts carry release identity; `main` can still produce test/build artifacts
for verification. Notarization proof may be useful before release publishing,
but docs should not imply that every notarized build is a tagged release.

Do not change release workflows, branch filters, tagging, notarization, or
update policy as part of harness docs unless the task is explicitly scoped to
release/CI policy.

## Consequences

Agents should base work on `main` unless told otherwise. Release/CI changes must
read ENG-454, current workflows, and current branch protection/merge-queue state
before editing branch filters or release automation.

Docs, scripts, and agent instructions should not use `develop` as the implied
base branch. If a historical `develop` reference remains for context, label it
as historical or reconciliation debt.
