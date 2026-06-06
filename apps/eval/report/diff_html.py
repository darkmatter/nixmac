"""Unified-diff → HTML.

Splits the diff into per-file hunks. Each content line is syntax-highlighted
by Pygments and wrapped in <span class="diff-{add,del,ctx}"> so the row
background reads as red/green while the code itself is coloured.
"""

from __future__ import annotations

import html
from dataclasses import dataclass

from pygments import highlight
from pygments.formatters.html import HtmlFormatter
from pygments.lexers import TextLexer
from pygments.lexers.configs import TOMLLexer
from pygments.lexers.data import JsonLexer
from pygments.lexers.markup import MarkdownLexer
from pygments.lexers.nix import NixLexer

_FORMATTER = HtmlFormatter(nowrap=True)

# Suffix → lexer instance. Kept small on purpose — we'd rather render plain
# text than mis-guess a lexer.
_LEXERS = {
    ".nix": NixLexer(),
    ".toml": TOMLLexer(),
    ".json": JsonLexer(),
    ".md": MarkdownLexer(),
}
_TEXT = TextLexer()


def _lexer_for(path: str):
    for suffix, lexer in _LEXERS.items():
        if path.endswith(suffix):
            return lexer
    return _TEXT


def _highlight_line(content: str, lexer) -> str:
    # Pygments adds a trailing newline; strip it so we control wrapping.
    out = highlight(content, lexer, _FORMATTER)
    return out.rstrip("\n")


@dataclass
class _File:
    path: str
    header_lines: list[str]
    body_lines: list[str]


def _split_files(diff: str) -> list[_File]:
    files: list[_File] = []
    current: _File | None = None
    for line in diff.splitlines():
        if line.startswith("diff --git "):
            # New file. Path is the b/ side.
            path = ""
            if " b/" in line:
                path = line.split(" b/", 1)[1].strip()
            current = _File(path=path, header_lines=[line], body_lines=[])
            files.append(current)
            continue
        if current is None:
            # Diff without a `diff --git` header (e.g. raw hunk). Synthesize.
            current = _File(path="", header_lines=[], body_lines=[])
            files.append(current)
        if line.startswith(("index ", "--- ", "+++ ", "new file mode", "deleted file mode", "rename ", "similarity ", "Binary files ")):
            current.header_lines.append(line)
        else:
            current.body_lines.append(line)
    return files


def render(diff: str) -> str:
    """Render a unified diff as a self-contained HTML fragment.

    Returns "" for an empty diff; callers decide what placeholder to show.
    """
    diff = diff or ""
    if not diff.strip():
        return ""

    parts: list[str] = []
    for f in _split_files(diff):
        lexer = _lexer_for(f.path)
        parts.append('<div class="diff-file">')
        if f.path:
            parts.append(f'<div class="diff-file-header">{html.escape(f.path)}</div>')
        parts.append('<pre class="diff-body"><code>')
        for line in f.body_lines:
            if line.startswith("@@"):
                parts.append(f'<span class="diff-hunk">{html.escape(line)}</span>')
                continue
            if line.startswith("+"):
                cls = "diff-add"
                content = line[1:]
            elif line.startswith("-"):
                cls = "diff-del"
                content = line[1:]
            elif line.startswith("\\"):
                # e.g. "\ No newline at end of file"
                parts.append(f'<span class="diff-meta">{html.escape(line)}</span>')
                continue
            else:
                cls = "diff-ctx"
                content = line[1:] if line.startswith(" ") else line
            parts.append(f'<span class="{cls}">{_highlight_line(content, lexer)}</span>')
        parts.append("</code></pre>")
        parts.append("</div>")
    return "".join(parts)


def pygments_css() -> str:
    """Pygments token CSS — emit once into style.css via copy."""
    return HtmlFormatter().get_style_defs(".diff-body")
