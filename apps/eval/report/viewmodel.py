"""View-model the templates consume.

Loaders produce these; the renderer reads them. Templates never touch
the raw result JSON.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime


@dataclass(frozen=True)
class CheckView:
    name: str
    passed: bool
    detail: str


@dataclass(frozen=True)
class CaseView:
    case_id: int
    prompt: str
    notes: str | None
    category: str
    subcategory: str
    priority: str
    expected_outcome: str
    is_golden: bool

    passed: bool
    failure_class: str | None
    checks: list[CheckView]
    has_grade: bool

    diff: str
    diff_html: str
    conversational_reply: str | None
    commit_message: str | None
    summary_instructions: str | None

    iterations: int
    build_attempts: int
    edits_count: int
    tool_calls_count: int | None
    thinking_count: int | None
    duration_ms: int
    total_tokens: int
    state: str

    log_excerpt: str | None

    evolve_model: str | None
    evolve_provider: str | None

    @property
    def status_label(self) -> str:
        if not self.has_grade:
            return "ungraded"
        return "pass" if self.passed else "fail"

    @property
    def outcome_label(self) -> str:
        """What actually happened, as a single label.

        Passing cases collapse to the expected outcome (e.g. "succeed").
        Failing cases collapse to the failure class (e.g. "other") — the
        expected outcome is implicit ("it was supposed to succeed and it
        failed with X") and would mislead if shown next to a fail-coloured
        badge.
        """
        if not self.has_grade:
            return "ungraded"
        if self.passed:
            return self.expected_outcome or "unknown"
        return self.failure_class or "unclassified"

    @property
    def prompt_truncated(self) -> str:
        if len(self.prompt) <= 80:
            return self.prompt
        return self.prompt[:77] + "…"


@dataclass(frozen=True)
class RunMeta:
    title: str
    generated_at: datetime
    run_started_at: datetime | None
    run_finished_at: datetime | None
    evolve_models: list[str]
    evolve_providers: list[str]
    summary_models: list[str]
    nixmac_git_sha: str | None
    eval_host: str | None
    cli_args: str | None
    sourced_from: str  # "run_meta.json" | "derived"


@dataclass(frozen=True)
class Segment:
    name: str
    cases: list[CaseView]

    @property
    def total(self) -> int:
        return len(self.cases)

    @property
    def passed(self) -> int:
        return sum(1 for c in self.cases if c.passed)

    @property
    def failed(self) -> int:
        return sum(1 for c in self.cases if not c.passed)

    @property
    def pass_rate(self) -> float:
        return (self.passed / self.total * 100.0) if self.total else 0.0

    @property
    def dominant_failure_class(self) -> str | None:
        classes: dict[str, int] = {}
        for c in self.cases:
            if c.passed:
                continue
            cls = c.failure_class or "unclassified"
            classes[cls] = classes.get(cls, 0) + 1
        if not classes:
            return None
        return max(classes.items(), key=lambda kv: kv[1])[0]


@dataclass(frozen=True)
class OutcomeCount:
    """One row of the outcome breakdown — either a passing outcome or a failure class."""

    label: str
    count: int
    kind: str  # "pass" | "fail"


@dataclass(frozen=True)
class StatRow:
    """One row of the aggregate stats table.

    kind drives styling:
      - "data":    label + values (e.g. "Cases", "Edits (avg)")
      - "group":   group header, no values (e.g. "Duration", "Iterations")
      - "sub":     indented sub-row under a group (e.g. "avg (s)", "median")
      - "spacer":  blank visual gap between groups
    """

    kind: str
    label: str
    overall: str
    passing: str
    failing: str


@dataclass(frozen=True)
class AggregateStats:
    total: int
    passed: int
    failed: int
    pass_rate: float
    rows: list[StatRow] = field(default_factory=list)


@dataclass(frozen=True)
class RunView:
    meta: RunMeta
    cases: list[CaseView]
    segments: list[Segment]
    aggregate_stats: AggregateStats
    outcome_breakdown: list[OutcomeCount]
    compare_to: RunView | None = None
