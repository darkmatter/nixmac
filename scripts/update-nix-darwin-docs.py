# update-nix-darwin-docs.py
# This script updates the nix-darwin documentation at (repo-root)/apps/native/src-tauri/resources/nix-darwin-docs.json
# using the following workflow:
# 1. Fetch the latest nix-darwin documentation as HTML from https://nix-darwin.github.io/nix-darwin/manual/
# 2. Parse the HTML to extract the relevant documentation sections
# 3. Convert the extracted sections into a structured JSON format:
#    {
#        "option_path": "(string)", // The full path of the option (e.g., "services.nginx.enable")
#        "summary": "(string)", // The full summary of the option, including its default value if available
#        "option_type": "(string)", // The type of the option (e.g., "boolean", "string", "integer", "list", "attribute set") if available
#    }
# 4. Save the structured JSON data to (repo-root)/apps/native/src-tauri/resources/nix-darwin-docs.json
# Note: This script requires the 'requests' and 'beautifulsoup4' libraries to be installed.

"""Fetch and parse nix-darwin manual into structured JSON used by the native app.

Usage:
  python scripts/update-nix-darwin-docs.py

Options:
  --url URL           : Manual URL to fetch (defaults to nix-darwin manual)
  --out PATH          : Output JSON path (defaults to apps/native/src-tauri/resources/nix-darwin-docs.json)

The parser uses heuristics to find option-like identifiers (dot-separated
attribute-paths such as `services.nginx.enable`) and extracts the following
fields for each option:
  - option_path: the dotted attribute path
  - summary: short textual summary (one or more paragraphs)
  - option_type: best-effort classification (boolean, string, integer, list,
	attribute set, path, derivation, unknown)

The script is intentionally conservative: it deduplicates candidates and
attempts to avoid including unrelated code snippets.
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


DEFAULT_URL = "https://nix-darwin.github.io/nix-darwin/manual/"
DEFAULT_OUT = "apps/native/src-tauri/resources/nix-darwin-docs.json"


OPTION_RE = re.compile(r"^[a-zA-Z0-9_][-a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_][-a-zA-Z0-9_]*)+$")
TYPE_KEYWORDS = {
	"boolean": ["boolean", "bool", "true|false", "on|off", "enable"],
	"string": ["string", "text", "path"],
	"integer": ["integer", "int", "number"],
	"list": ["list", "array", "sequence"],
	"attribute set": ["attribute set", "attrset", "attrs"],
	"derivation": ["derivation", "drv"],
}


def fetch_html(url: str) -> str:
	# Support local files via file:// or direct path for offline testing
	if url.startswith("file://"):
		path = url[len("file://") :]
		with open(path, "r", encoding="utf-8") as f:
			return f.read()

	if os.path.exists(url):
		with open(url, "r", encoding="utf-8") as f:
			return f.read()

	resp = requests.get(url, timeout=30)
	resp.raise_for_status()
	return resp.text


def text_of_tag(tag: Tag) -> str:
	# Get visible text from a tag, collapse whitespace, strip
	text = tag.get_text(separator="\n")
	return re.sub(r"\s+", " ", text).strip()


def find_option_candidates(soup: BeautifulSoup) -> List[Tag]:
	# Legacy helper kept for compatibility; prefer parsing dl.variablelist
	candidates: List[Tag] = []
	for tag in soup.find_all(["code", "tt", "dfn", "kbd", "span"]):
		if not isinstance(tag, Tag):
			continue
		txt = tag.get_text().strip()
		if OPTION_RE.match(txt) and txt.count(".") >= 1:
			candidates.append(tag)
	return candidates


def extract_summary_for_tag(tag: Tag) -> str:
	# Search for a nearby paragraph-like sibling or the following siblings
	# up to the next heading
	parts: List[str] = []

	# Prefer next sibling paragraphs
	sibling = tag.parent
	# If parent is a heading, prefer following siblings
	if sibling and sibling.name and sibling.name.startswith("h"):
		node = sibling.next_sibling
	else:
		node = tag.next_sibling

	traversed = 0
	while node and traversed < 20:
		traversed += 1
		if isinstance(node, Tag):
			name = node.name.lower()
			if name and name.startswith("h"):
				break
			if name in ("p", "div", "dd", "blockquote"):
				txt = text_of_tag(node)
				if txt:
					parts.append(txt)
					# stop after collecting one paragraph to keep summary brief
					break
			# sometimes description is in a <dt>/<dd> or immediately in the parent
			if name in ("dd",):
				txt = text_of_tag(node)
				if txt:
					parts.append(txt)
					break
		node = node.next_sibling

	# Fallback: try parent paragraph or next paragraph in document order
	if not parts:
		parent = tag.parent
		if parent:
			p = parent.find_next(["p", "dd"])
			if p:
				parts.append(text_of_tag(p))

	return "\n\n".join(parts)[:2000].strip()


def detect_type(summary: str) -> str:
	s = summary.lower()
	for t, keywords in TYPE_KEYWORDS.items():
		for kw in keywords:
			if kw in s:
				return t
	return "unknown"


def normalize_whitespace(s: str) -> str:
	return re.sub(r"\s+", " ", s).strip()


def first_sentence(s: str, max_len: int) -> str:
	sentence = s.split(".").next() if hasattr(s.split("."), '__iter__') else s.split(".")[0]
	# fallback without panicking
	sentence = s.split(".")[0].strip()
	if len(sentence) <= max_len:
		return sentence
	return f"{sentence[:max_len]}..."


def build_docs(soup: BeautifulSoup) -> List[Dict[str, Optional[str]]]:
	"""
	Prefer parsing the <dl class="variablelist"> structure used by the
	generated manual. For each <dt>/<dd> pair, extract an anchor id (if
	present), the option path, a short summary, and the option type.
	"""
	results: List[Dict[str, Optional[str]]] = []
	seen = set()

	# Find the main variablelist DLs
	dls = soup.find_all("dl", class_=lambda c: c and "variablelist" in c) or \
		soup.find_all("div", class_=lambda c: c and "variablelist" in c)

	for dl in dls:
		# iterate dt/dd pairs
		children = [c for c in dl.children if isinstance(c, Tag)]
		i = 0
		while i < len(children):
			node = children[i]
			if node.name != "dt":
				i += 1
				continue

			dt = node
			# find following dd (could be next child)
			dd = None
			if i + 1 < len(children) and children[i + 1].name == "dd":
				dd = children[i + 1]

			# anchor id in dt (e.g., <a id="opt-...">)
			anchor_tag = dt.find("a", id=True)
			anchor_id = anchor_tag["id"].strip() if anchor_tag else None

			# find option path inside code tags with class 'option' or similar
			option_text = None
			for code in dt.find_all("code"):
				txt = code.get_text().strip()
				if OPTION_RE.match(txt):
					option_text = txt
					break

			# fallback: search dt text for dotted pattern
			if not option_text:
				m = re.search(r"[a-zA-Z0-9_][-a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_][-a-zA-Z0-9_]*)+", dt.get_text())
				if m:
					option_text = m.group(0)

			if not option_text:
				i += 1
				continue

			if option_text in seen:
				i += 1
				continue
			seen.add(option_text)

			# Summary: prefer first meaningful <p> in dd
			summary = None
			option_type = None
			if dd:
				# find first paragraph that isn't a 'Type:' or 'Default:' label
				for p in dd.find_all(["p", "div"]):
					txt = text_of_tag(p)
					if not txt:
						continue
					if re.search(r"(?i)^(type:|default:|declared by:)", txt):
						# look for type label specifically
						tmatch = re.search(r"(?i)type:\s*(.+)$", txt)
						if tmatch and not option_type:
							option_type = normalize_whitespace(tmatch.group(1))
						continue
					# otherwise first real paragraph is our summary
					summary = txt
					break

				# If still no type, attempt to find a <p> containing Type: later
				if not option_type:
					# try to locate a paragraph where <em>Type:</em> is used
					type_p = dd.find(lambda tag: tag.name == "p" and "Type:" in tag.get_text())
					if type_p:
						# extract following text after 'Type:'
						t = re.split(r"(?i)Type:\s*", type_p.get_text(), maxsplit=1)
						if len(t) > 1:
							option_type = normalize_whitespace(t[1])

			if not summary:
				# fallback to the first sentence of the dd text
				if dd:
					dd_text = text_of_tag(dd)
					summary = first_sentence(dd_text, 220)
				else:
					summary = None

			if option_type:
				option_type = option_type.strip()
			else:
				# best-effort detection from summary
				option_type = detect_type(summary or "")

			results.append({
				"option_path": option_text,
				"anchor_id": anchor_id,
				"summary": summary or None,
				"option_type": option_type or None,
			})

			i += 1

	# If we didn't find any dl-based entries, fall back to old candidate scanning
	if not results:
		candidates = find_option_candidates(soup)
		for tag in candidates:
			opt = tag.get_text().strip()
			if not opt or opt in seen:
				continue
			seen.add(opt)
			summary = extract_summary_for_tag(tag)
			option_type = detect_type(summary)
			results.append({
				"option_path": opt,
				"anchor_id": None,
				"summary": summary or None,
				"option_type": option_type,
			})

	return results


def save_json(data: List[Dict[str, Optional[str]]], out_path: str) -> None:
	os.makedirs(os.path.dirname(out_path), exist_ok=True)
	with open(out_path, "w", encoding="utf-8") as f:
		json.dump(data, f, ensure_ascii=False, indent=2)


def main(argv: List[str]) -> int:
	p = argparse.ArgumentParser(description="Update nix-darwin docs JSON")
	p.add_argument("--url", default=DEFAULT_URL)
	p.add_argument("--out", default=DEFAULT_OUT)
	args = p.parse_args(argv)

	print(f"Fetching manual from: {args.url}")
	html = fetch_html(args.url)
	soup = BeautifulSoup(html, "html.parser")

	print("Extracting option candidates...")
	docs = build_docs(soup)

	print(f"Found {len(docs)} option candidates, writing to {args.out}")
	save_json(docs, args.out)
	print("Done.")
	return 0


if __name__ == "__main__":
	raise SystemExit(main(sys.argv[1:]))

