#!/usr/bin/env python3

"""Generate the compact search_docs compatibility index from options JSON."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any


def build_docs(options: dict[str, Any]) -> list[dict[str, str | None]]:
    docs: list[dict[str, str | None]] = []
    for path in sorted(options):
        entry = options[path]
        if not isinstance(entry, dict):
            continue
        docs.append(
            {
                "option_path": path,
                "anchor_id": f"opt-{path}",
                "summary": entry.get("description") or "",
                "option_type": entry.get("type"),
            }
        )
    return docs


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Generate search_docs JSON from nixosOptionsDoc options JSON."
    )
    parser.add_argument("options_file", type=Path)
    parser.add_argument("docs_file", type=Path)
    args = parser.parse_args()

    with args.options_file.open("r", encoding="utf-8") as f:
        options = json.load(f)

    docs = build_docs(options)
    os.makedirs(args.docs_file.parent, exist_ok=True)
    with args.docs_file.open("w", encoding="utf-8") as f:
        json.dump(docs, f, ensure_ascii=False, indent=2)
        f.write("\n")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
