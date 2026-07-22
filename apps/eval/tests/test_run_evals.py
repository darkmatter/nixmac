"""Tests for run_evals lifecycle/evidence helpers.

Run from apps/eval with: uv run --extra dev pytest
"""

import json

import run_evals


class TestScrubSecrets:
    def test_redacts_each_secret(self):
        text = "key=sk-abc123 other=tok-999"
        out = run_evals._scrub_secrets(text, ["sk-abc123", "tok-999"])
        assert "sk-abc123" not in out
        assert "tok-999" not in out
        assert out.count("«redacted»") == 2

    def test_ignores_empty_secrets(self):
        assert run_evals._scrub_secrets("hello", ["", None]) == "hello"  # type: ignore[list-item]


class TestResultIsUnclean:
    def test_timeout_is_unclean(self):
        assert run_evals._result_is_unclean({"state": "generated"}, timed_out=True)

    def test_stub_success_false_is_unclean(self):
        assert run_evals._result_is_unclean({"success": False}, timed_out=False)

    def test_ok_false_is_unclean(self):
        assert run_evals._result_is_unclean({"ok": False}, timed_out=False)

    def test_limit_reached_is_unclean(self):
        result = {"ok": True, "result": {"telemetry": {"state": "limitReached"}}}
        assert run_evals._result_is_unclean(result, timed_out=False)

    def test_clean_generated_run_is_clean(self):
        result = {"ok": True, "result": {"telemetry": {"state": "generated"}}}
        assert not run_evals._result_is_unclean(result, timed_out=False)

    def test_non_dict_is_clean(self):
        assert not run_evals._result_is_unclean(None, timed_out=False)


class TestHarvestCaseArtifacts:
    def test_copies_and_scrubs_logs_and_partial(self, tmp_path):
        app_data = tmp_path / "appdata"
        (app_data / "logs").mkdir(parents=True)
        (app_data / "logs" / "evolve_2026-07-22.jsonl").write_text(
            '{"prompt": "hi", "key": "sk-secret"}\n'
        )
        result_dir = tmp_path / "result"
        result_dir.mkdir()
        (result_dir / "evolution_result.json").write_text('{"partial": true}')
        results_dir = tmp_path / "results"
        results_dir.mkdir()

        run_evals.harvest_case_artifacts(app_data, result_dir, results_dir, 42, ["sk-secret"])

        artifacts = results_dir / "case_42_artifacts"
        log_out = (artifacts / "evolve_2026-07-22.jsonl").read_text()
        assert "sk-secret" not in log_out
        assert "«redacted»" in log_out
        partial_out = json.loads((artifacts / "evolution_result.partial.json").read_text())
        assert partial_out == {"partial": True}

    def test_no_artifacts_dir_when_nothing_to_copy(self, tmp_path):
        app_data = tmp_path / "appdata"
        app_data.mkdir()
        results_dir = tmp_path / "results"
        results_dir.mkdir()

        run_evals.harvest_case_artifacts(app_data, None, results_dir, 7, [])

        assert not (results_dir / "case_7_artifacts").exists()


class TestRunMeta:
    def test_redacted_cli_args_hides_secrets(self):
        import argparse

        ns = argparse.Namespace(
            evolve_model="glm",
            openai_key="sk-should-not-appear",
            vllm_api_key="vllm-secret",
            case_timeout=600,
            func=lambda a: None,
        )
        out = run_evals._redacted_cli_args(ns)
        assert out["openai_key"] == "«redacted»"
        assert out["vllm_api_key"] == "«redacted»"
        assert out["evolve_model"] == "glm"
        assert out["case_timeout"] == 600
        assert "func" not in out
