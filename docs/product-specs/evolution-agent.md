# Evolution Agent Domain

The evolve agent changes the user's nix-darwin config. This is the core product
promise and the highest correctness bar.

## Agent Contract

The in-app agent should:

- Stay in nix-darwin/macOS configuration scope.
- Read files before editing.
- Prefer `edit_nix_file` for structured Nix changes.
- Use `search_packages` before installing packages and follow its
  `install_target`.
- Use `search_docs` for uncertain nix-darwin/home-manager option paths.
- Run `build_check` before `done` after edits.
- Use `ensure_secret` for secret creation and wiring.
- Never read or log plaintext secret values.

The prompt contract is in `apps/native/src-tauri/prompts/system.md`.

## Known Failure Classes

- Agent rejects a request but UI moves to Save with an empty diff.
- Review page can show when git is clean if DB/view state diverges from git.
- Long builds can display outside the intended view.
- Repeated edit failures and stop heuristics need clear user-visible recovery.
- Summarization and cached DB state can mask the actual git state.
- Token budgeting based only on line count or unconstrained reason fields can
  still overflow on long lines or verbose model responses.
- Prompt cache can be lost when early prompt prefixes change per run.
- Base-template evals can miss host/platform-specific config bugs.

## Implementation Guidance

- Treat git state as the final source for diffs and review/save transitions.
- Avoid duplicating the same evolution status across DB, git, and frontend
  state unless there is a reconciliation path.
- Agent logs should make rejection, build failure, and no-op outcomes visible.
- Build-check repair flows should be explicit. A "Fix with AI" path is desired
  for logs/review failures, but it must show what it will attempt.
- Do not offer "Fix with AI" for failures editing Nix cannot solve. Suppress or
  route differently for permission, authorization, cancellation, and `/etc`
  clobber classes.
- Keep prompts stable where caching matters. Move variable material later in the
  prompt when possible.
- Use real tokenizer-aware limits for token-sensitive code; character or line
  counts are only rough proxies.
- Preserve truthful DB/query semantics. Do not encode status indirectly through
  nullable joins or other query tricks that make the data model harder to reason
  about.

## Verification

For backend changes, add Rust tests around tool dispatch, path safety, git state,
or build-check behavior. For UI state changes, add unit tests around viewmodel
transitions and manual app verification when possible.
