#!/usr/bin/env bash
# Container size analysis tool for nix2container images
# Usage: container-size [options] [path-to-json]
#
# Options:
#   -t, --tree     Show dependency tree with sizes
#   -l, --layers   Show per-layer breakdown (default)
#   -s, --summary  Show only total size
#   -h, --help     Show this help

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

json=""
mode="layers"

usage() {
  head -12 "$0" | tail -10 | sed 's/^# //' | sed 's/^#//'
  exit 0
}

hr_size() {
  local bytes=$1
  if command -v numfmt &>/dev/null; then
    numfmt --to=iec-i --suffix=B "$bytes"
  else
    # Fallback for systems without numfmt
    local kb=$((bytes / 1024))
    local mb=$((kb / 1024))
    if ((mb > 0)); then
      echo "${mb}MiB"
    elif ((kb > 0)); then
      echo "${kb}KiB"
    else
      echo "${bytes}B"
    fi
  fi
}

show_summary() {
  local total
  total=$(jq '[.layers[].size] | add // 0' "$json")
  echo -e "${BOLD}Total compressed size:${NC} $(hr_size "$total")"
}

show_layers() {
  echo -e "${BOLD}=== Container Size Analysis ===${NC}"
  echo

  show_summary
  
  echo
  echo -e "${BOLD}Layer breakdown:${NC}"
  jq -r '.layers[] | "\(.size)\t\(.paths[0].path // "base")"' "$json" | \
    sort -rn | \
    while IFS=$'\t' read -r size path; do
      hr=$(hr_size "$size")
      short=$(basename "$path" 2>/dev/null | cut -c1-60 || echo "$path")
      printf "  ${CYAN}%10s${NC}  %s\n" "$hr" "$short"
    done

  echo
  echo -e "${BOLD}Top 5 largest layers:${NC}"
  jq -r '.layers | sort_by(-.size) | .[0:5][] | "\(.size)\t\(.paths[0].path // "unknown")"' "$json" | \
    while IFS=$'\t' read -r size path; do
      hr=$(hr_size "$size")
      short=$(basename "$path" 2>/dev/null || echo "$path")
      printf "  ${YELLOW}%10s${NC}  %s\n" "$hr" "$short"
    done
}

show_tree() {
  echo -e "${BOLD}=== Container Dependency Tree ===${NC}"
  echo
  show_summary
  echo

  # Extract all store paths from the container
  local paths
  paths=$(jq -r '.layers[].paths[]?.path // empty' "$json" | sort -u)
  
  if [[ -z "$paths" ]]; then
    echo "No paths found in container."
    return
  fi

  # Build dependency tree for each top-level path
  echo -e "${BOLD}Store paths and their dependencies:${NC}"
  echo
  
  # Get unique top-level packages (dedup by package name)
  local seen_pkgs=""
  
  while IFS= read -r path; do
    [[ -z "$path" ]] && continue
    [[ ! -e "$path" ]] && continue
    
    # Extract package name (remove hash prefix)
    local pkg_name
    pkg_name=$(basename "$path" | sed 's/^[a-z0-9]\{32\}-//')
    
    # Skip if we've seen this package
    if echo "$seen_pkgs" | grep -qF "$pkg_name"; then
      continue
    fi
    seen_pkgs="$seen_pkgs $pkg_name"
    
    # Get size of this path
    local size
    size=$(nix path-info -S "$path" 2>/dev/null | awk '{print $2}' || echo "0")
    local closure_size
    closure_size=$(nix path-info -S --closure-size "$path" 2>/dev/null | awk '{print $2}' || echo "0")
    
    echo -e "${GREEN}📦 ${pkg_name}${NC}"
    echo -e "   Size: $(hr_size "${size:-0}") | Closure: $(hr_size "${closure_size:-0}")"
    
    # Show immediate dependencies (depth 1)
    local deps
    deps=$(nix-store -q --references "$path" 2>/dev/null || true)
    
    if [[ -n "$deps" ]]; then
      local dep_count
      dep_count=$(echo "$deps" | wc -l | tr -d ' ')
      echo -e "   ${BLUE}Dependencies (${dep_count}):${NC}"
      
      echo "$deps" | head -10 | while IFS= read -r dep; do
        local dep_name
        dep_name=$(basename "$dep" | sed 's/^[a-z0-9]\{32\}-//')
        local dep_size
        dep_size=$(nix path-info -S "$dep" 2>/dev/null | awk '{print $2}' || echo "0")
        printf "   ├── %-45s %s\n" "$dep_name" "$(hr_size "${dep_size:-0}")"
      done
      
      if ((dep_count > 10)); then
        echo "   └── ... and $((dep_count - 10)) more"
      fi
    fi
    echo
  done <<< "$paths"
  
  # Show what's taking the most space in closure
  echo -e "${BOLD}=== Largest Dependencies (by closure) ===${NC}"
  echo
  
  # Collect all paths and their closure sizes
  local all_deps
  all_deps=$(mktemp)
  
  while IFS= read -r path; do
    [[ -z "$path" ]] && continue
    [[ ! -e "$path" ]] && continue
    nix-store -qR "$path" 2>/dev/null || true
  done <<< "$paths" | sort -u | while IFS= read -r dep; do
    [[ -z "$dep" ]] && continue
    local size
    size=$(nix path-info -S "$dep" 2>/dev/null | awk '{print $2}' || echo "0")
    local name
    name=$(basename "$dep" | sed 's/^[a-z0-9]\{32\}-//')
    echo "$size $name"
  done | sort -rn | head -15 | while read -r size name; do
    printf "  ${RED}%10s${NC}  %s\n" "$(hr_size "$size")" "$name"
  done
  
  rm -f "$all_deps" 2>/dev/null || true
}

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    -t|--tree)
      mode="tree"
      shift
      ;;
    -l|--layers)
      mode="layers"
      shift
      ;;
    -s|--summary)
      mode="summary"
      shift
      ;;
    -h|--help)
      usage
      ;;
    -*)
      echo "Unknown option: $1" >&2
      usage
      ;;
    *)
      json="$1"
      shift
      ;;
  esac
done

# Default json path
json="${json:-.devenv/gc/container-web-derivation}"

if [[ ! -f "$json" ]]; then
  echo "File not found: $json" >&2
  echo "Run 'devenv container build web' first." >&2
  exit 1
fi

case $mode in
  summary)
    show_summary
    ;;
  layers)
    show_layers
    ;;
  tree)
    show_tree
    ;;
esac
