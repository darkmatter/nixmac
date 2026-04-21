#!/usr/bin/env bash
# Lightweight orchestrator for manual test flow described in docs/manual-test-cases.md
# Usage: docs/testscripts/manual-test.sh <command> [--yes] [--out FILE]

set -euo pipefail

PROG_NAME=$(basename "$0")
DRY_RUN=true
OUT=""

while [[ $# -gt 0 && "$1" == --* ]]; do
  case "$1" in
    --yes)
      DRY_RUN=false
      shift
      ;;
    --out)
      shift
      OUT="$1"
      shift
      ;;
    --help|-h)
      echo "Usage: $PROG_NAME <command> [--yes] [--out FILE]"
      echo "Commands: show-state, env-check, summarize, diff, commit, help"
      exit 0
      ;;
    *)
      break
      ;;
  esac
done

cmd=${1-}
shift || true

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

check_state() {
  if [[ -n "$OUT" ]]; then
    "$SCRIPT_DIR/check-state.sh" --out "$OUT"
  else
    "$SCRIPT_DIR/check-state.sh"
  fi
}

env_check() {
  # Print values for a set of env var names in a login shell.
  # Usage:
  #   docs/testscripts/manual-test.sh env-check TEST1 TEST2
  #   TESTS=MYVAR,OTHERVAR docs/testscripts/manual-test.sh env-check
  local vars=()
  if [[ -n "${TESTS-}" ]]; then
    IFS=',' read -r -a vars <<< "$TESTS"
  elif [[ $# -gt 0 ]]; then
    vars=("$@")
  else
    vars=(TEST1 TEST2 TEST3)
  fi

  echo "Running a login shell check for: ${vars[*]}"
  # Build a single bash -c command that echoes each variable on its own line
  local cmd=""
  for v in "${vars[@]}"; do
    cmd+="echo \"\$$v\"; "
  done
  bash -l -c "$cmd"
}

summarize() {
  echo "Git status summary:";
  git status --porcelain=v1 --branch
  echo
  echo "Changed files (unstaged and staged):"
  git diff --name-status || true
  echo
  echo "Staged changes (if any):"
  git diff --cached --name-status || true
}

show_diff() {
  echo "Full diff (worktree vs HEAD):"
  git --no-pager diff || true
}

do_commit() {
  if $DRY_RUN; then
    echo "DRY RUN: would stage and commit. Rerun with --yes to perform."
    summarize
    exit 0
  fi

  msg="$1"
  if [[ -z "$msg" ]]; then
    read -r -p "Commit message: " msg
  fi
  git add -A
  git commit -m "$msg"
  echo "Committed.";
}

case "$cmd" in
  show-state)
    check_state
    ;;
  env-check)
    env_check "$@"
    ;;
  summarize)
    summarize
    ;;
  diff)
    show_diff
    ;;
  commit)
    do_commit "$*"
    ;;
  help|""|--help|-h)
    echo "Usage: $PROG_NAME <command> [--yes] [--out FILE]"
    echo
    echo "Commands:"
    echo "  show-state   Print and optionally copy state files (uses check-state.sh)"
    echo "  env-check    Run a login shell and print TEST1/TEST2/TEST3"
    echo "  summarize    Show git status and changed files summary"
    echo "  diff         Show full git diff"
    echo "  commit       Stage and commit changes (use --yes to actually commit)"
    echo "  help         Show this help"
    ;;
  *)
    echo "Unknown command: $cmd" >&2
    echo "Run: $PROG_NAME help" >&2
    exit 2
    ;;
esac
