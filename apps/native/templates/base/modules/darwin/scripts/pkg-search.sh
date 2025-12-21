#!/usr/bin/env bash

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

show_usage() {
  echo -e "${BOLD}Usage:${NC} pkg? [options] <search-term>"
  echo ""
  echo -e "${BOLD}Description:${NC}"
  echo "  Search for packages in nixpkgs using regex patterns"
  echo ""
  echo -e "${BOLD}Examples:${NC}"
  echo -e "  pkg? vim                # Search for packages containing 'vim'"
  echo -e "  pkg? '^vim'             # Search for packages starting with 'vim'"
  echo -e "  pkg? 'python.*jupyter'  # Search using regex pattern"
  echo -e "  pkg? -d vim             # Show detailed package info"
  echo -e "  pkg? -j vim             # Output as JSON"
  echo ""
  echo -e "${BOLD}Options:${NC}"
  echo "  -h, --help              Show this help message"
  echo "  -d, --detailed          Show detailed package information"
  echo "  -j, --json              Output in JSON format"
  echo "  -e, --exclude <pattern> Exclude packages matching pattern"
  echo "  -n, --number <n>        Limit results to n packages (default: 50)"
}

DETAILED=0
JSON=0
LIMIT=50
EXCLUDE=""

while [[ $# -gt 0 ]]; do
  case $1 in
    -h|--help) show_usage; exit 0 ;;
    -d|--detailed) DETAILED=1; shift ;;
    -j|--json) JSON=1; shift ;;
    -e|--exclude) EXCLUDE="$2"; shift 2 ;;
    -n|--number) LIMIT="$2"; shift 2 ;;
    -*) echo -e "${RED}Unknown option: $1${NC}"; show_usage; exit 1 ;;
    *) break ;;
  esac
done

if [ $# -eq 0 ]; then
  echo -e "${RED}Error: No search term provided${NC}"
  show_usage
  exit 1
fi

SEARCH_TERM="$*"
NIX_CMD="nix search nixpkgs"

if [ $JSON -eq 1 ]; then
  NIX_CMD="$NIX_CMD --json"
fi

NIX_CMD="$NIX_CMD \"$SEARCH_TERM\""

if [ $JSON -eq 0 ]; then
  echo -e "${BLUE}🔍 Searching nixpkgs for:${NC} ${YELLOW}$SEARCH_TERM${NC}"
  echo ""
fi

if [ $JSON -eq 1 ]; then
  eval "$NIX_CMD" 2>/dev/null
else
  RESULTS=$(eval "$NIX_CMD" 2>/dev/null)

  if [ -z "$RESULTS" ]; then
    echo -e "${YELLOW}No packages found matching '$SEARCH_TERM'${NC}"
    exit 0
  fi

  COUNT=0
  while IFS= read -r line; do
    if [[ -z "$line" ]]; then continue; fi

    if [[ "$line" =~ ^\*[[:space:]]+(.*) ]]; then
      PACKAGE_PATH="${BASH_REMATCH[1]}"

      if [[ -n "$EXCLUDE" ]] && [[ "$PACKAGE_PATH" =~ $EXCLUDE ]]; then
        continue
      fi

      ((COUNT++))
      if [ $COUNT -gt $LIMIT ]; then
        echo -e "\n${YELLOW}Showing first $LIMIT results. Use -n to show more.${NC}"
        break
      fi

      PACKAGE_NAME="${PACKAGE_PATH##*.}"
      echo -e "${GREEN}●${NC} ${BOLD}$PACKAGE_NAME${NC} ${CYAN}($PACKAGE_PATH)${NC}"

      if [ $DETAILED -eq 0 ]; then
        read -r desc_line
        if [[ "$desc_line" =~ ^[[:space:]]+(.+) ]]; then
          echo -e "  ${BASH_REMATCH[1]}"
        fi
        echo ""
      fi
    elif [ $DETAILED -eq 1 ] && [[ "$line" =~ ^[[:space:]]+(.+) ]]; then
      echo -e "  ${BASH_REMATCH[1]}"
    fi
  done <<< "$RESULTS"

  echo -e "\n${BLUE}Found $COUNT packages${NC}"
fi

