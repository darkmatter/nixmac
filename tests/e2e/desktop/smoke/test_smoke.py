"""Fixture tests use real files, Git commits, processes and profile symlinks, without a Mac."""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from bootstrap import bootstrap
from launch import launch, read_private_key
from smoke_support import HOST, PROMPT, Locations, SmokeError, object_json, write_json
from verify import checkpoint, verify


class SmokeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.locations = Locations(
            root / "home",
            root / "work",
            root / "system",
            root / "nixmac.app",
            root / "store",
            Path(shutil.which("git")),
        )
        self.locations.home.mkdir()
        self.locations.store_root.mkdir()
        self.git_env = {
            **os.environ,
            "GIT_AUTHOR_NAME": "Smoke fixture",
            "GIT_AUTHOR_EMAIL": "smoke@example.invalid",
            "GIT_COMMITTER_NAME": "Smoke fixture",
            "GIT_COMMITTER_EMAIL": "smoke@example.invalid",
        }

    def tearDown(self):
        self.temp.cleanup()

    def git(self, *args):
        result = subprocess.run(
            [str(self.locations.git), "-C", str(self.locations.config), *args],
            env=self.git_env,
            check=True,
            capture_output=True,
            text=True,
        )
        return result.stdout.strip()

    def prepare(self):
        result = bootstrap(self.locations, "openrouter", "test/model")
        now = result["mission"]["startedAt"]
        write_json(
            self.locations.work / "launch.json",
            {
                "status": "launched",
                "credentialInjected": True,
                "mockSystem": False,
                "startedAt": now,
            },
        )
        self.locations.config.mkdir()
        self.git("init", "-q")
        (self.locations.config / "flake.nix").write_text(
            "{ environment.systemPackages = [ pkgs.vim ]; }\n"
        )
        self.git("add", "flake.nix")
        self.git("commit", "-qm", "Initial configuration")
        head = self.git("rev-parse", "HEAD")
        prefs = object_json(self.locations.state / "global-preferences.json")
        prefs.update(
            configDir=str(self.locations.config),
            repoRoot=str(self.locations.config),
            hostAttr=HOST,
        )
        write_json(self.locations.state / "global-preferences.json", prefs)
        write_json(
            self.locations.state / "onboarding-state.json",
            {
                "completedAt": now,
                "lastBuildAt": now,
                "macScannedAt": now,
                "loginDecided": True,
            },
        )
        self.set_build("first-system", head, now)
        return now

    def set_build(self, name, head, now, package=False):
        store = self.locations.store_root / name
        (store / "sw/bin").mkdir(parents=True)
        if package:
            executable = store / "sw/bin/rg"
            executable.write_text("#!/bin/sh\nprintf 'ripgrep 14.1.0\\n'\n")
            executable.chmod(0o755)
        self.locations.system.unlink(missing_ok=True)
        self.locations.system.symlink_to(store)
        write_json(
            self.locations.state / "build-state.json",
            {
                "buildState": {
                    "nixmacBuiltStorePath": str(store),
                    "currentNixStorePath": str(store),
                    "headCommitHash": head,
                    "builtAt": now,
                    "changesetId": None,
                }
            },
        )

    def evolve(self, *, state="generated", tool_calls=True):
        now = int(time.time())
        (self.locations.config / "flake.nix").write_text(
            "{ environment.systemPackages = [ pkgs.vim pkgs.ripgrep ]; }\n"
        )
        self.git("add", "flake.nix")
        self.git("commit", "-qm", "Add ripgrep")
        self.set_build(
            "evolved-system", self.git("rev-parse", "HEAD"), now, package=True
        )
        metadata = {
            "createdAt": now,
            "state": state,
            "prompt": PROMPT,
            "iterations": 2,
            "totalTokens": 500,
            "edits": [
                {
                    "path": "flake.nix",
                    "search": "private unretained content",
                    "replace": "pkgs.ripgrep",
                }
            ],
            "buildAttempts": 1,
            "toolCalls": (
                [
                    {
                        "tool": "edit_file",
                        "success": True,
                        "argsSummary": "private arguments",
                    },
                    {"tool": "build_check", "success": True},
                ]
                if tool_calls
                else []
            ),
            "messages": [{"content": "private conversation sentinel"}],
        }
        write_json(
            self.locations.state / "settings.json",
            {
                "usageStatistics": {
                    "totalEvolutions": 1,
                    "successfulEvolutions": 1,
                    "failedEvolutions": 0,
                },
                "evolveMetadata": json.dumps(metadata),
                "unrelatedSecret": "do-not-retain-this-sentinel",
            },
        )

    def test_bootstrap_provisions_real_provider_without_completing_onboarding(self):
        self.locations.state.mkdir(parents=True)
        write_json(
            self.locations.state / "global-preferences.json",
            {"helperPreference": "disabled"},
        )
        result = bootstrap(
            self.locations, "vllm", "org/model", "https://gateway.example.invalid/v1"
        )
        prefs = object_json(self.locations.state / "global-preferences.json")
        self.assertEqual(prefs["evolveProvider"], "openai_compatible")
        self.assertEqual(prefs["helperPreference"], "disabled")
        onboarding = object_json(self.locations.state / "onboarding-state.json")
        self.assertIsNone(onboarding["completedAt"])
        self.assertIsNone(onboarding["lastBuildAt"])
        self.assertIsNone(onboarding["macScannedAt"])
        self.assertTrue(result["mission"]["inferenceProvisioned"])
        self.assertFalse((self.locations.work / "provider-key").exists())
        with self.assertRaisesRegex(SmokeError, "already prepared"):
            bootstrap(self.locations, "openai", "test/model")

    def test_bootstrap_rejects_used_state_and_credentialed_url_before_writing(self):
        with self.assertRaisesRegex(SmokeError, "credentials"):
            bootstrap(
                self.locations,
                "vllm",
                "model",
                "https://token@gateway.example.invalid/v1",
            )
        self.assertFalse(self.locations.work.exists())
        self.locations.state.mkdir(parents=True)
        write_json(self.locations.state / "onboarding-state.json", {"completedAt": 1})
        with self.assertRaisesRegex(SmokeError, "fresh onboarding"):
            bootstrap(self.locations, "openai", "model")
        self.assertFalse(self.locations.work.exists())

    def test_real_files_commits_and_profile_pass_without_retaining_private_state(self):
        self.prepare()
        initial = checkpoint(self.locations)
        self.evolve()
        report = verify(self.locations)
        self.assertEqual(report["status"], "passed")
        self.assertEqual(report["commit"]["parent"], initial["head"])
        self.assertEqual(report["evolution"]["successfulEditCalls"], 1)
        self.assertFalse(report["offboardingPerformed"])
        retained = (self.locations.work / "verification.json").read_text()
        for private_text in (
            "private conversation",
            "private arguments",
            "do-not-retain",
            "messages",
            "unrelatedSecret",
        ):
            self.assertNotIn(private_text, retained)

    def test_checkpoint_retries_preserve_the_original_receipt_and_reject_changed_builds(
        self,
    ):
        now = self.prepare()
        path = self.locations.state / "onboarding-state.json"
        value = object_json(path)
        value["completedAt"] = now - 100
        write_json(path, value)
        with self.assertRaisesRegex(SmokeError, "fresh completion"):
            checkpoint(self.locations)
        value["completedAt"] = now
        write_json(path, value)
        initial = checkpoint(self.locations)
        with patch("verify.time.time", return_value=now + 60):
            self.assertEqual(checkpoint(self.locations), initial)
        self.set_build("different-system", self.git("rev-parse", "HEAD"), now)
        with self.assertRaisesRegex(SmokeError, "different mission, commit, or build"):
            checkpoint(self.locations)
        self.assertEqual(
            object_json(self.locations.work / "onboarding-checkpoint.json"), initial
        )

    def test_narrative_and_limit_outcomes_do_not_count_as_evolution(self):
        self.prepare()
        checkpoint(self.locations)
        self.evolve(tool_calls=False)
        with self.assertRaisesRegex(SmokeError, "successful edit tool"):
            verify(self.locations)
        settings_path = self.locations.state / "settings.json"
        settings = object_json(settings_path)
        metadata = json.loads(settings["evolveMetadata"])
        metadata["state"] = "limitReached"
        settings["evolveMetadata"] = metadata
        write_json(settings_path, settings)
        with self.assertRaisesRegex(SmokeError, "unsuccessful"):
            verify(self.locations)

    def test_uncommitted_or_unactivated_evolution_is_rejected(self):
        self.prepare()
        checkpoint(self.locations)
        self.evolve()
        path = self.locations.config / "flake.nix"
        path.write_text(path.read_text() + "# unsaved\n")
        with self.assertRaisesRegex(SmokeError, "uncommitted"):
            verify(self.locations)
        self.git("restore", "flake.nix")
        self.locations.system.unlink()
        self.locations.system.symlink_to(self.locations.store_root / "first-system")
        with self.assertRaisesRegex(SmokeError, "live activated system"):
            verify(self.locations)

    def test_launch_consumes_private_key_without_inheriting_mock_flags(self):
        bootstrap(self.locations, "openrouter", "test/model")
        executable = self.locations.app / "Contents/MacOS/nixmac"
        executable.parent.mkdir(parents=True)
        executable.write_text(
            f"#!{sys.executable}\nimport os, pathlib\n"
            "ok = os.environ.get('OPENROUTER_API_KEY') == 'fixture-private-token' "
            "and 'NIXMAC_E2E_MOCK_SYSTEM' not in os.environ\n"
            "pathlib.Path(os.environ['HOME'], 'process-proof').write_text('ok' if ok else 'bad')\n"
        )
        executable.chmod(0o755)
        key = self.locations.work / "provider-key"
        key.write_text("fixture-private-token\n")
        key.chmod(0o600)
        with patch.dict(os.environ, {"NIXMAC_E2E_MOCK_SYSTEM": "1"}):
            receipt = launch(self.locations)
        os.waitpid(receipt["pid"], 0)
        self.assertEqual((self.locations.home / "process-proof").read_text(), "ok")
        self.assertFalse(key.exists())
        self.assertNotIn("fixture-private-token", json.dumps(receipt))
        self.assertEqual(
            (self.locations.work / "private-app.log").stat().st_mode & 0o777, 0o600
        )

    def test_private_key_rejects_world_readable_or_linked_file(self):
        key = self.locations.home / "key"
        key.write_text("fixture-token")
        key.chmod(0o644)
        with self.assertRaisesRegex(SmokeError, "0600"):
            read_private_key(key)
        key.chmod(0o600)
        link = self.locations.home / "linked-key"
        link.symlink_to(key)
        with self.assertRaisesRegex(SmokeError, "private provider key"):
            read_private_key(link)

    def test_failed_exec_is_not_reported_as_launched_or_replayed(self):
        bootstrap(self.locations, "openrouter", "test/model")
        executable = self.locations.app / "Contents/MacOS/nixmac"
        executable.parent.mkdir(parents=True)
        executable.write_text("not an executable format\n")
        executable.chmod(0o755)
        key = self.locations.work / "provider-key"
        key.write_text("fixture-private-token")
        key.chmod(0o600)
        with self.assertRaisesRegex(SmokeError, "exec failed"):
            launch(self.locations)
        self.assertFalse((self.locations.work / "launch.json").exists())
        self.assertTrue((self.locations.work / "launch-attempt.json").exists())
        with self.assertRaisesRegex(SmokeError, "persist"):
            launch(self.locations)


if __name__ == "__main__":
    unittest.main()
