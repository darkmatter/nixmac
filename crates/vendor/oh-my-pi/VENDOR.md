# Vendored Oh My Pi crates

Pure-Rust extracts from [can1357/oh-my-pi](https://github.com/can1357/oh-my-pi) for nixmac’s evolve agent tools (file walk, in-process grep, AST summarize, CoW isolation).

## Pin

| Field | Value |
| --- | --- |
| Upstream | <https://github.com/can1357/oh-my-pi> |
| Commit | `a38cd95d7d8c457a22f1b81c059b5491d78f79a3` |
| Upstream version | 17.1.2 |
| License | MIT (see `LICENSE`) — Mario Zechner, Can Bölük |

## Crates

| Crate | Role in nixmac |
| --- | --- |
| `pi-walker` | Directory walk / list_files / discovery cache |
| `pi-uutils-ctx` | Thread-local stdio/cwd context required by `pi-uu-grep` |
| `pi-uu-grep` | In-process ripgrep-backed search (`search_code`) |
| `pi-ast` | Tree-sitter / ast-grep helpers for summarized `read_file` |
| `pi-iso` | CoW isolation backends for subagent workspaces |

**Not vendored:** `pi-natives` (N-API), `pi-shell` / brush / uu-\* (shell harness), `@oh-my-pi/hashline` (TypeScript).

## Sync from upstream

```bash
git clone https://github.com/can1357/oh-my-pi /tmp/oh-my-pi
cd /tmp/oh-my-pi && git checkout <new-sha>
ROOT=<nixmac-root>
for crate in pi-walker pi-uutils-ctx pi-uu-grep pi-iso pi-ast; do
  rsync -a --delete \
    --exclude target --exclude Cargo.lock \
    "/tmp/oh-my-pi/crates/$crate/" \
    "$ROOT/crates/vendor/oh-my-pi/$crate/"
done
# Re-apply standalone Cargo.toml edits (no workspace inherit / no host lints).
# Update the commit SHA in this file.
```

Vendored `Cargo.toml` files are rewritten so packages do **not** inherit Oh My Pi’s workspace metadata or nixmac’s deny-level clippy lints. Prefer replaying those edits after a sync rather than copying upstream `Cargo.toml` verbatim.

## Wiring status

1. **Done:** Summarized `read_file` → `pi-ast` (`evolve/tools/read_file.rs`)
1. **Done:** `list_files` → `pi-walker` (`evolve/tools/list_files.rs`, cache on)
1. **Done:** `search_code` → `pi_uu_grep` (`evolve/search_code.rs`)
1. **Done:** Walker cache invalidate after edits (`evolve/file_ops.rs`)
1. **Done:** Isolation API → `pi-iso` (`evolve/isolation.rs` — `create_isolated_workspace` for subagents)
1. Pending (optional): Trim `pi-ast` tree-sitter grammars

Keep `evolve/file_ops.rs` + `edit_file` as the product security / validation boundary.
