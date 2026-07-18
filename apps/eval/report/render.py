"""Render a RunView to a directory of HTML files + assets."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, StrictUndefined, select_autoescape

from report.diff_html import pygments_css
from report.viewmodel import RunView

_PKG_DIR = Path(__file__).parent
_TEMPLATES_DIR = _PKG_DIR / "templates"
_ASSETS_DIR = _PKG_DIR / "assets"


def _build_env() -> Environment:
    env = Environment(
        loader=FileSystemLoader(_TEMPLATES_DIR),
        autoescape=select_autoescape(["html", "j2"]),
        undefined=StrictUndefined,
        trim_blocks=True,
        lstrip_blocks=True,
    )
    env.filters["pct"] = lambda n: f"{n:.1f}%"
    env.filters["duration"] = _format_duration
    env.filters["tokens"] = _format_tokens
    env.filters["short"] = _short
    env.filters["isoformat"] = lambda d: d.isoformat(timespec="seconds") if d else ""
    env.filters["outcome_label"] = lambda s: s.replace("_", " ").capitalize() if s else ""
    return env


def _format_duration(ms: int | None) -> str:
    if ms is None:
        return "—"
    secs = ms / 1000.0
    if secs < 60:
        return f"{secs:.1f}s"
    mins, secs = divmod(secs, 60)
    return f"{int(mins)}m{int(secs):02d}s"


def _format_tokens(n: int | None) -> str:
    if n is None:
        return "—"
    if n < 1000:
        return str(n)
    return f"{n/1000:.1f}k"


def _short(s: str | None, length: int = 80) -> str:
    s = s or ""
    s = s.replace("\n", " ").strip()
    if len(s) <= length:
        return s
    return s[: length - 1] + "…"


def _manifest(run: RunView) -> dict:
    return {
        "generated_at": run.meta.generated_at.isoformat(timespec="seconds"),
        "title": run.meta.title,
        "evolve_models": run.meta.evolve_models,
        "total": run.aggregate_stats.total,
        "passed": run.aggregate_stats.passed,
        "failed": run.aggregate_stats.failed,
        "pass_rate": run.aggregate_stats.pass_rate,
        "case_outcomes": {
            str(c.case_id): {"passed": c.passed, "failure_class": c.failure_class}
            for c in run.cases
        },
    }


def write(run: RunView, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    cases_dir = out_dir / "cases"
    cases_dir.mkdir(exist_ok=True)
    assets_dir = out_dir / "assets"
    assets_dir.mkdir(exist_ok=True)

    env = _build_env()

    index_tpl = env.get_template("index.html.j2")
    (out_dir / "index.html").write_text(index_tpl.render(run=run))

    case_tpl = env.get_template("case.html.j2")
    for i, case in enumerate(run.cases):
        prev_id = run.cases[i - 1].case_id if i > 0 else None
        next_id = run.cases[i + 1].case_id if i < len(run.cases) - 1 else None
        (cases_dir / f"case_{case.case_id}.html").write_text(
            case_tpl.render(run=run, case=case, prev_id=prev_id, next_id=next_id)
        )

    # Assets: static files + dynamic Pygments CSS appended to style.css.
    for src in _ASSETS_DIR.iterdir():
        if src.is_file():
            shutil.copy2(src, assets_dir / src.name)
    # Append Pygments token styles to the copied style.css (idempotent: this
    # writes a fresh file each time).
    style_path = assets_dir / "style.css"
    base_css = style_path.read_text() if style_path.exists() else ""
    style_path.write_text(base_css + "\n\n/* Pygments tokens */\n" + pygments_css())

    (out_dir / "manifest.json").write_text(json.dumps(_manifest(run), indent=2))
