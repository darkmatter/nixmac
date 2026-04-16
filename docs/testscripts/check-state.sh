#!/bin/bash
# Show evolve-state.json and build-state.json in the terminal and copy both to clipboard.
{ echo '```javascript'; echo "// evolve-state.json"; cat ~/Library/Application\ Support/com.darkmatter.nixmac/evolve-state.json; echo; echo '```'; echo; echo '```javascript'; echo "// build-state.json"; cat ~/Library/Application\ Support/com.darkmatter.nixmac/build-state.json; echo; echo '```'; } | tee >(pbcopy)
