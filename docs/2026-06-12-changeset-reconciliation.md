# Reconcile Dangling Changesets

- Date: 2026-06-12
- Status: proposal, not yet scheduled
- Relates to: the stale-session bug fixed by `48c9802d`/`8b69766d`/`3a894c60`,
  `docs/2026-06-12-viewmodel-completion-plan.md` (general direction: derive
  from the source, validate before trusting durable state)

## Context

The stale-session investigation (see the three commits above) surfaced a
second, independent instance of the same disease in SQLite. A `change_sets`
row records a unit of summarized work:

- `commit_id` — the commit the changeset was eventually committed as.
  `NULL` means "still uncommitted, lives in the working tree".
- `base_commit_id` — the commit the changes were diffed against.
- `set_changes` → `changes` — per-file change rows, keyed by a content hash
  of the diff hunk.

`commit_id` is only ever filled in by nixmac's own commit path. When the
user commits the working tree by hand (or any tool other than nixmac
commits), the changeset stays **dangling**: `commit_id NULL`, but its
changes are now part of history and the working tree is clean.

Observed in the field (2026-06-12): changesets 10 and 11 dangling, both
describing changes that had long been committed manually; `build-state.json`
pointed at changeset 11 as "what we built". The dangling rows did not cause
the Review-page bug (that was the evolve-session anchor, now fixed), but
they have real costs:

1. **Lost history.** The summaries generated for those changes never attach
   to the commit that contains them. The History view shows the manual
   commit without its semantic summary, and the work to generate it is
   wasted.
1. **Stale joins.** `find_existing::for_current_state` matches current
   working-tree change hashes against stored changesets. A dangling set
   whose hashes happen to re-match (e.g. the user reverts and redoes an
   edit) can resurrect summaries for changes from a different era.
1. **Build-state coupling.** `build_state.changeset_id` references a
   changeset that no longer corresponds to anything checkable;
   `current_state_built` then degrades to hash-set comparison against a
   ghost.

## Proposal

Add a one-shot **reconciliation pass at startup** (and after the watcher
detects a HEAD move), owned by the summarize/db layer:

For each `change_sets` row with `commit_id IS NULL`:

1. **Resolve the base.** Look up `base_commit_id`'s hash. If the commit no
   longer exists in the repo (history rewritten), mark the changeset
   abandoned (see below).
1. **Try to attach.** Walk `base..HEAD` (bounded, e.g. 50 commits — these
   rows are recent by construction). For each commit, compute the per-file
   change hashes of its diff with the same hashing used for working-tree
   changes (`git::change hash` over the hunk). If a commit's hash set
   contains the changeset's hashes, set `commit_id` to that commit
   (inserting a `commits` row if missing). The changeset's summaries now
   show up in History under the manual commit — the user's hand-commit is
   adopted rather than discarded.
1. **Otherwise check the working tree.** If the changeset's hashes still
   match the current uncommitted diff, it is genuinely in-flight — leave it
   alone (this is the normal mid-session case).
1. **Otherwise abandon.** The changes are neither in history nor in the
   tree (reverted, rebased away). Mark the row abandoned rather than
   deleting it — add an `abandoned_at INTEGER` column (NULL = live) so the
   sumlog/debugging trail survives but every live-state query
   (`for_current_state`, history joins, `current_state_built`) filters
   `abandoned_at IS NULL`.

Build-state follow-up: when reconciliation attaches or abandons the
changeset referenced by `build_state.changeset_id`, re-anchor build state
the same way `current_state_built` would naturally resolve it (attached →
the build corresponds to that commit; abandoned → drop `changeset_id` and
let the store-path comparison alone decide).

## Why hash-matching is sound here

The change hash is a content hash of the file's diff hunk against the base.
A manual commit that contains exactly the working-tree changes nixmac
summarized produces identical hunks against the same base, hence identical
hashes. Partial manual commits (user commits half the files) attach
nothing — the changeset stays dangling and step 3 keeps matching the
remaining tree changes, which is the correct reading of that state.
False positives would require an identical hunk against the same base in an
unrelated commit within the bounded walk — acceptable, since attaching a
summary to a commit that contains exactly those changes is correct by
definition.

## Scope and ordering

- One migration (add `abandoned_at`), one reconciliation module called from
  startup after DB init, one watcher hook on HEAD-move, filters added to
  the three live-state queries.
- Independent of the ViewModel work; can land any time. Best done after the
  current branch merges so the reconciliation can rely on the cells
  (git-state / change-map) rather than re-querying.
- Test plan: temp-repo fixtures for the four outcomes (attach to manual
  commit, leave in-flight, abandon after revert, abandon after history
  rewrite); regression test that `for_current_state` ignores abandoned
  rows whose hashes re-match.
