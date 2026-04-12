# update-home-manager-docs.py
# This script updates the home-manager documentation at (repo-root)/apps/native/src-tauri/resources/home-manager-docs.json
# using the following workflow:
# 1. Fetch the latest home-manager documentation as HTML from https://nix-community.github.io/home-manager/options.xhtml
# 2. Parse the HTML to extract the relevant documentation sections
# 3. Convert the extracted sections into a structured JSON format:
#    {
#        "option_path": "(string)", // The full path of the option (e.g., "programs.git.enable")
#        "anchor_id": "(string)",   // The anchor id for linking (e.g., "opt-programs.git.enable")
#        "summary": "(string)",     // The description/summary of the option
#        "option_type": "(string)", // The type of the option (e.g., "boolean", "string", etc.)
#    }
# 4. Save the structured JSON data to (repo-root)/apps/native/src-tauri/resources/home-manager-docs.json
# Note: This script requires the 'requests' and 'beautifulsoup4' libraries to be installed.

"""Fetch and parse home-manager manual into structured JSON used by the native app.

Usage:
  python scripts/update-home-manager-docs.py

Options:
  --url URL           : Manual URL to fetch (defaults to home-manager options page)
  --out PATH          : Output JSON path (defaults to apps/native/src-tauri/resources/home-manager-docs.json)

The parser walks the <dl> containing <dt>/<dd> pairs from the options page and
extracts the following fields for each option:
  - option_path: the dotted attribute path (e.g. programs.git.enable)
  - anchor_id: the HTML anchor id for deep-linking (e.g. opt-programs.git.enable)
  - summary: short textual description
  - option_type: the declared Nix type (boolean, string, etc.)
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from typing import Dict, List, Optional

import requests
from bs4 import BeautifulSoup, Tag


DEFAULT_URL = "https://nix-community.github.io/home-manager/options.xhtml"
DEFAULT_OUT = "apps/native/src-tauri/resources/home-manager-docs.json"


def fetch_html(url: str) -> str:
    # Support local files via file:// or direct path for offline testing
    if url.startswith("file://"):
        path = url[len("file://"):]
        with open(path, "r", encoding="utf-8") as f:
            return f.read()

    if os.path.exists(url):
        with open(url, "r", encoding="utf-8") as f:
            return f.read()

    resp = requests.get(url, timeout=120)
    resp.raise_for_status()
    return resp.text


def text_of_tag(tag: Tag) -> str:
    """Get visible text from a tag, collapse whitespace, strip."""
    text = tag.get_text(separator=" ")
    return re.sub(r"\s+", " ", text).strip()


def normalize_whitespace(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def build_docs(soup: BeautifulSoup) -> List[Dict[str, Optional[str]]]:
    """
    Parse the home-manager options page. The structure is a flat sequence of
    <dt>/<dd> pairs inside one or more <dl> elements. Each <dt> contains an
    anchor <a id="opt-..."> and a <code class="option"> with the option path.
    Each <dd> contains <p> elements for Description, Type, Default, Example,
    and Declared by.
    """
    results: List[Dict[str, Optional[str]]] = []
    seen: set[str] = set()

    # Collect all <dl> elements (the options page typically has one large dl,
    # but we handle multiple just in case).
    dls = soup.find_all("dl")
    if not dls:
        print("WARNING: No <dl> elements found in the document.", file=sys.stderr)
        return results

    for dl in dls:
        children = [c for c in dl.children if isinstance(c, Tag)]
        i = 0
        while i < len(children):
            node = children[i]
            if node.name != "dt":
                i += 1
                continue

            dt = node
            # Find the following <dd>
            dd = None
            if i + 1 < len(children) and children[i + 1].name == "dd":
                dd = children[i + 1]

            # Extract anchor id from <a id="opt-...">
            anchor_tag = dt.find("a", id=True)
            anchor_id = anchor_tag["id"].strip() if anchor_tag else None

            # Extract option path from <code class="option">
            option_text = None
            code_tag = dt.find("code", class_="option")
            if code_tag:
                option_text = code_tag.get_text().strip()

            # Fallback: search for any dotted identifier in the dt text
            if not option_text:
                m = re.search(
                    r"[a-zA-Z0-9_][-a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_<>][-a-zA-Z0-9_<>]*)+",
                    dt.get_text(),
                )
                if m:
                    option_text = m.group(0)

            if not option_text:
                i += 1
                continue

            if option_text in seen:
                i += 1
                continue
            seen.add(option_text)

            # Parse the <dd> for summary and type
            summary = None
            option_type = None

            if dd:
                # Walk <p> elements inside dd
                for p in dd.find_all("p", recursive=False):
                    p_text = text_of_tag(p)
                    if not p_text:
                        continue

                    # Check for Type: label
                    em = p.find("em")
                    if em:
                        em_text = em.get_text().strip()
                        if em_text == "Type:":
                            # Type value is the text after the em, in the same <p>
                            type_text = p_text
                            t = re.split(r"Type:\s*", type_text, maxsplit=1)
                            if len(t) > 1:
                                option_type = normalize_whitespace(t[1])
                            continue
                        if em_text in ("Default:", "Example:", "Declared by:"):
                            continue

                    # If we haven't found a summary yet, this is likely the description
                    if summary is None:
                        summary = p_text

            # Truncate summary to a reasonable length
            if summary and len(summary) > 2000:
                summary = summary[:2000].strip()

            results.append({
                "option_path": option_text,
                "anchor_id": anchor_id,
                "summary": summary or None,
                "option_type": option_type or None,
            })

            i += 1

    return results


def save_json(data: List[Dict[str, Optional[str]]], out_path: str) -> None:
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def main(argv: List[str]) -> int:
    p = argparse.ArgumentParser(description="Update home-manager docs JSON")
    p.add_argument("--url", default=DEFAULT_URL)
    p.add_argument("--out", default=DEFAULT_OUT)
    args = p.parse_args(argv)

    print(f"Fetching manual from: {args.url}")
    html = fetch_html(args.url)
    soup = BeautifulSoup(html, "html.parser")

    print("Extracting option entries...")
    docs = build_docs(soup)

    print(f"Found {len(docs)} options, writing to {args.out}")
    save_json(docs, args.out)
    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
