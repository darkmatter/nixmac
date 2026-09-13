#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# Execute the actual workflow-owned writer, which must also work when the
# requested source revision predates this test and has no provenance helper.
python3 - "$REPO_ROOT/.github/workflows/build.yaml" <<'PY'
import hashlib
import json
import os
from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile
import textwrap
from unittest.mock import patch

workflow = Path(sys.argv[1]).read_text()
admission_step = workflow.split("      - name: Validate exact build request\n", 1)[1].split("\n      - name:", 1)[0]
admission = textwrap.dedent(admission_step.split("        run: |\n", 1)[1])
step = workflow.split("      - name: Write exact build provenance\n", 1)[1].split("      - name:", 1)[0]
source = textwrap.dedent(step.split("        run: |\n", 1)[1])
writer = compile(source, "workflow build provenance", "exec")
expected = "a" * 40
workflow_sha = "b" * 40
environment = {
    "NIXMAC_SOURCE_SHA": expected,
    "NIXMAC_REQUEST_ID": "desktop-request-123",
    "GITHUB_REPOSITORY": "darkmatter/nixmac",
    "GITHUB_EVENT_NAME": "workflow_dispatch",
    "GITHUB_WORKFLOW_REF": "darkmatter/nixmac/.github/workflows/build.yaml@refs/heads/main",
    "GITHUB_WORKFLOW_SHA": workflow_sha,
    "GITHUB_RUN_ID": "12345",
    "GITHUB_RUN_ATTEMPT": "2",
}

with tempfile.TemporaryDirectory() as directory:
    admission_output = Path(directory) / "admission-output"
    admission_env = {**os.environ, "GITHUB_OUTPUT": str(admission_output), "GITHUB_SHA": workflow_sha,
                     "GITHUB_EVENT_NAME": "workflow_dispatch", "GITHUB_REF": "refs/heads/main", "GITHUB_RUN_ATTEMPT": "1",
                     "DEFAULT_BRANCH": "main", "SOURCE_REF": expected, "REQUEST_ID": "desktop-request-123"}
    for overrides, valid, selected in [
        ({}, True, expected),
        ({"SOURCE_REF": "", "REQUEST_ID": ""}, True, workflow_sha),
        ({"SOURCE_REF": "main"}, False, None),
        ({"SOURCE_REF": "a" * 39}, False, None),
        ({"REQUEST_ID": "invalid request"}, False, None),
        ({"GITHUB_REF": "refs/tags/v1.2.3"}, False, None),
        ({"GITHUB_REF": "refs/tags/v1.2.3", "SOURCE_REF": "", "REQUEST_ID": ""}, False, None),
        ({"GITHUB_REF": "refs/heads/topic", "SOURCE_REF": "", "REQUEST_ID": ""}, False, None),
        ({"GITHUB_RUN_ATTEMPT": "2"}, False, None),
        ({"GITHUB_EVENT_NAME": "push", "GITHUB_RUN_ATTEMPT": "2"}, True, expected),
    ]:
        admission_output.unlink(missing_ok=True)
        result = subprocess.run(["bash", "-c", admission], env={**admission_env, **overrides}, capture_output=True, text=True)
        assert (result.returncode == 0) == valid, result.stderr
        if valid:
            assert admission_output.read_text() == "sha=" + selected + "\n"
        else:
            assert not admission_output.exists()
    original = Path.cwd()
    os.chdir(directory)
    try:
        app = Path("target/release/bundle/macos/nixmac.app/Contents")
        (app / "MacOS").mkdir(parents=True)
        binary = app / "MacOS/nixmac"
        binary.write_bytes(b"fixture executable inspected by mocked native lipo")
        dmg = Path("target/release/bundle/dmg/nixmac_1.2.3_aarch64.dmg")
        dmg.parent.mkdir(parents=True)
        dmg.write_bytes(b"signed and notarized fixture DMG")
        output = dmg.parent / "nixmac-build-provenance.json"
        bundle = {"CFBundleIdentifier": "com.darkmatter.nixmac", "CFBundleShortVersionString": "1.2.3",
                  "CFBundleExecutable": "nixmac", "NixmacBuildId": expected}

        def run(build_id=expected, arch="arm64", checkout=expected):
            with (app / "Info.plist").open("wb") as stream:
                plistlib.dump({**bundle, "NixmacBuildId": build_id}, stream)
            output.unlink(missing_ok=True)

            def command(argv, **options):
                if argv == ["git", "rev-parse", "HEAD"]:
                    return checkout + "\n"
                if argv == ["/usr/bin/lipo", "-archs", str(binary)]:
                    return arch + "\n"
                raise AssertionError("Unexpected native command: " + repr(argv))

            with patch.dict(os.environ, environment), patch.object(subprocess, "check_output", side_effect=command):
                exec(writer, {})

        run()
        actual = json.loads(output.read_text())
        assert actual["schemaVersion"] == "nixmac.desktop-build.v1"
        assert actual["sourceSha"] == actual["bundleBuildId"] == expected
        assert actual["workflowSha"] == workflow_sha and actual["workflowSha"] != actual["sourceSha"]
        assert actual["requestId"] == "desktop-request-123"
        assert actual["runId"] == 12345 and actual["runAttempt"] == 2
        assert actual["architectures"] == ["arm64"]
        assert actual["dmg"] == {"fileName": dmg.name, "bytes": dmg.stat().st_size,
                                 "sha256": hashlib.sha256(dmg.read_bytes()).hexdigest()}
        for case in [{"build_id": "c" * 40}, {"checkout": "c" * 40}, {"arch": "x86_64"}]:
            try:
                run(**case)
            except ValueError:
                pass
            else:
                raise AssertionError("Mismatched source or architecture was admitted: " + repr(case))
            assert not output.exists(), "Rejected build retained a success manifest"
        duplicate = dmg.parent / "second_aarch64.dmg"
        duplicate.write_bytes(b"ambiguous candidate")
        try:
            run()
        except ValueError:
            pass
        else:
            raise AssertionError("Ambiguous DMG selection was admitted")
        assert not output.exists()
    finally:
        os.chdir(original)
print("workflow build provenance tests passed")
PY
