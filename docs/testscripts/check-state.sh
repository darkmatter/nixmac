#!/usr/bin/env bash
# Show evolve-state.json and build-state.json in the terminal and optionally copy to clipboard or write to a file.

set -euo pipefail

OUT=""    # if non-empty, write combined output to this file
COPY=false # copy to clipboard via pbcopy when true

while [[ $# -gt 0 ]]; do
	case "$1" in
		--out)
			shift
			OUT="$1"
			;;
		--copy)
			COPY=true
			;;
		-h|--help)
			cat <<'USAGE'
Usage: check-state.sh [--out FILE] [--copy]

Prints the evolve-state.json and build-state.json stored in
~/Library/Application Support/com.darkmatter.nixmac/.

Options:
	--out FILE   Write the combined formatted output to FILE.
	--copy       Also copy the output to the macOS clipboard (pbcopy).
	-h, --help   Show this help.
USAGE
			exit 0
			;;
		*)
			echo "Unknown arg: $1" >&2
			exit 2
			;;
	esac
	shift
done

STATE_DIR="$HOME/Library/Application Support/com.darkmatter.nixmac"
EVOLVE_FILE="$STATE_DIR/evolve-state.json"
BUILD_FILE="$STATE_DIR/build-state.json"

output() {
	echo '```javascript'
	echo "// evolve-state.json"
	if [[ -f "$EVOLVE_FILE" ]]; then
		cat "$EVOLVE_FILE"
	else
		echo "// (not found: $EVOLVE_FILE)"
	fi
	echo
	echo '```'
	echo
	echo '```javascript'
	echo "// build-state.json"
	if [[ -f "$BUILD_FILE" ]]; then
		cat "$BUILD_FILE"
	else
		echo "// (not found: $BUILD_FILE)"
	fi
	echo
	echo '```'
}

if [[ -n "$OUT" ]]; then
	# write to file and also print to stdout
	output | tee "$OUT"
	if $COPY; then
		output | pbcopy
	fi
else
	if $COPY; then
		output | tee >(pbcopy)
	else
		output
	fi
fi

