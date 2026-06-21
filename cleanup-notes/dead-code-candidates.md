# Dead Code Candidates

Items flagged for worker 3. These are stub markers, incomplete TODOs with callers, or incomplete implementations that cannot be safely deleted without further investigation.

| file:line | comment / construct | reason flagged |
| --------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/commands.rs:615` | `// TODO: Implement actual cancellation by tracking the child process` | `darwin_apply_stream_cancel` is a real Tauri command with frontend callers. The function stashes to a branch but never sends SIGTERM/SIGKILL to the running `darwin-rebuild` child process. The cancellation is incomplete and should track the PID. |
