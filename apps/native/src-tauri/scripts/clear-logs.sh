#!/usr/bin/env bash

# Blows away all the log files underneath ~/Library/Application\ Support/nixmac/logs
# which is useful when testing.
set -euo pipefail
log_dir="$HOME/Library/Application Support/nixmac/logs"
echo "Clearing logs in $log_dir"
find "$log_dir" -type f -name "*.log" -delete
echo "Logs cleared"