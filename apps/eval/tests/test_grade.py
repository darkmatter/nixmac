"""Focused tests for grade.py check semantics.

Run from apps/eval with: uv run --extra dev pytest
"""

import grade


def make_result(
    diff: str = "",
    edits: int = 0,
    builds: int = 0,
    conversational: str | None = None,
    state: str = "generated",
) -> dict:
    """Build a minimal result envelope in the shape grade.py consumes."""
    return {
        "_case_id": 1,
        "ok": True,
        "state": state,
        "result": {
            "gitStatus": {"diff": diff},
            "conversationalResponse": conversational,
            "telemetry": {
                "state": state,
                "editsCount": edits,
                "buildAttempts": builds,
                "iterations": 1,
            },
        },
    }


def edit_diff(path: str, added_line: str) -> str:
    return (
        f"diff --git a/{path} b/{path}\n"
        f"--- a/{path}\n"
        f"+++ b/{path}\n"
        "@@ -1,1 +1,2 @@\n"
        " existing\n"
        f"+{added_line}\n"
    )


class TestFlakeScope:
    def test_flake_edit_without_expectations_fails_flake_scope(self):
        result = make_result(diff=edit_diff("flake.nix", "something"), edits=1, builds=1)
        g = grade.grade_succeed(result, None, None)
        assert not g.checks["flake_scope"].passed

    def test_flake_edit_with_allowed_files_skips_flake_scope(self):
        result = make_result(diff=edit_diff("flake.nix", "home-manager"), edits=1, builds=1)
        expectations = {"allowed_files": ["flake.nix"]}
        g = grade.grade_succeed(result, expectations, None)
        assert "flake_scope" not in g.checks
        assert g.passed

    def test_flake_edit_with_expected_files_uses_expected_files_check(self):
        result = make_result(diff=edit_diff("flake.nix", "nixpkgs-unstable"), edits=1, builds=1)
        expectations = {"expected_files": ["flake.nix"]}
        g = grade.grade_succeed(result, expectations, None)
        assert "flake_scope" not in g.checks
        assert g.checks["expected_files"].passed

    def test_allowed_files_does_not_satisfy_expected_files(self):
        result = make_result(diff=edit_diff("flake.nix", "tmux"), edits=1, builds=1)
        expectations = {
            "expected_files": ["modules/darwin/home.nix"],
            "allowed_files": ["flake.nix"],
        }
        g = grade.grade_succeed(result, expectations, None)
        assert not g.checks["expected_files"].passed
        assert not g.passed

    def test_non_flake_allowed_files_do_not_bypass_flake_scope(self):
        result = make_result(diff=edit_diff("flake.nix", "whatever"), edits=1, builds=1)
        expectations = {"allowed_files": ["modules/darwin/home.nix"]}
        g = grade.grade_succeed(result, expectations, None)
        assert not g.checks["flake_scope"].passed

    def test_non_flake_edit_with_allowed_files_still_passes(self):
        result = make_result(
            diff=edit_diff("modules/darwin/home.nix", "programs.git.enable = true;"),
            edits=1,
            builds=1,
        )
        expectations = {"allowed_files": ["flake.nix"]}
        g = grade.grade_succeed(result, expectations, None)
        assert g.passed


class TestTerminalState:
    def test_limit_reached_succeed_case_fails_even_with_good_looking_diff(self):
        result = make_result(
            diff=edit_diff("modules/darwin/home.nix", "programs.git.enable = true;"),
            edits=5,
            builds=1,
            state="limitReached",
        )
        # Top-level state stays "generated" to mirror the pre-fix CLI hoist bug:
        # the grader must judge from telemetry.state, not the envelope.
        result["state"] = "generated"
        g = grade.grade_succeed(result, {"allowed_files": ["flake.nix"]}, None)
        assert not g.passed
        assert not g.checks["terminal_state"].passed
        assert g.failure_class == "limit_reached"

    def test_generated_state_has_no_terminal_state_check(self):
        result = make_result(
            diff=edit_diff("modules/darwin/packages.nix", "pkgs.htop"), edits=1, builds=1
        )
        g = grade.grade_succeed(result, None, None)
        assert "terminal_state" not in g.checks


class TestFailGracefully:
    def test_no_op_with_explanation_passes(self):
        result = make_result(conversational="Already installed for this host, no change needed.")
        g = grade.grade_fail_gracefully(result, {"require_empty_diff": True})
        assert g.passed

    def test_edit_on_required_no_op_fails(self):
        result = make_result(diff=edit_diff("flake.nix", "extra"), edits=1)
        g = grade.grade_fail_gracefully(result, {"require_empty_diff": True})
        assert not g.passed
