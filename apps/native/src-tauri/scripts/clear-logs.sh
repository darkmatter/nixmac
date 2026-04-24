#!/usr/bin/env bash

# Blows away all the log files underneath ~/Library/Application\ Support/nixmac/logs
# which is useful when testing.
set -euo pipefail
log_dir="$HOME/Library/Application Support/nixmac/logs"
if [ -d "$log_dir" ]; then
  echo "Clearing logs in $log_dir"
  # Remove .log and .jsonl files
  find "$log_dir" -type f \( -name "*.log" -o -name "*.jsonl" \) -delete
  echo "Logs cleared"
else
  echo "Log directory does not exist, nothing to clear"
fi
