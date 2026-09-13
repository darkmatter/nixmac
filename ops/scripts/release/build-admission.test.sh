#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# Execute the actual workflow-owned permission check with a mocked HTTP
# boundary. This test never creates a token or contacts GitHub.
python3 - "$REPO_ROOT/.github/workflows/build.yaml" <<'PY'
import contextlib
import io
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import textwrap
import urllib.error
import urllib.request
from unittest.mock import patch

workflow = Path(sys.argv[1]).read_text()
run_name = workflow.split("run-name: ", 1)[1].split("\n", 1)[0]
assert "inputs.authorize_only && 'Authorize desktop build' || 'Desktop build'" in run_name
assert "inputs.source_ref || github.sha" in run_name
step = workflow.split("      - name: Authorize manual build identities\n", 1)[1].split("\n  # Run the repo's git-hooks", 1)[0]
gate = compile(textwrap.dedent(step.split("        run: |\n", 1)[1]), "workflow membership gate", "exec")
hosted = workflow.split("  source:\n", 1)[1].split("\n  git-hooks:\n", 1)[0]
assert "runs-on: ubuntu-latest" in hosted
assert "actions/checkout" not in hosted and "uses: ./" not in hosted
assert "SOPS_AGE_KEY" not in workflow.split("\n  git-hooks:\n", 1)[0]
assert "uses: actions/create-github-app-token@fee1f7d63c2ff003460e3d139729b119787bc349" in hosted
assert "permission-members: read" in hosted and "repositories: nixmac" in hosted and "owner: darkmatter" in hosted
assert "skip-token-revoke: true" not in hosted

def member(login, state="active"):
    return {"state": state, "user": {"login": login, "id": 1 if login == "alice" else 2, "type": "User"},
            "organization": {"login": "darkmatter"}}

with tempfile.TemporaryDirectory() as directory:
    output = Path(directory) / "github-output"
    env = {"MEMBERSHIP_TOKEN": "fixture-token-never-real", "GITHUB_ACTOR": "alice",
           "GITHUB_TRIGGERING_ACTOR": "bob", "GITHUB_ACTOR_ID": "1", "GITHUB_OUTPUT": str(output)}

    def run(responses=None, overrides=None, success=False):
        output.unlink(missing_ok=True)
        responses = responses or {"alice": member("alice"), "bob": member("bob")}
        calls = []

        class Response(io.BytesIO):
            status = 200

        class HTTP:
            def open(self, request, timeout):
                assert timeout == 15
                assert request.get_method() == "GET"
                assert request.get_header("Authorization") == "Bearer fixture-token-never-real"
                assert request.full_url.startswith("https://api.github.com/orgs/darkmatter/memberships/")
                login = request.full_url.rsplit("/", 1)[1]
                calls.append(login)
                response = responses[login]
                if isinstance(response, Exception):
                    raise response
                status = 200
                if isinstance(response, tuple):
                    status, response = response
                result = Response(response if isinstance(response, bytes) else json.dumps(response).encode())
                result.status = status
                return result

        def opener(handler):
            assert handler.redirect_request(None, None, 302, None, None, "https://other.example") is None
            return HTTP()

        captured = io.StringIO()
        failed = None
        with patch.dict(os.environ, {**env, **(overrides or {})}), patch.object(urllib.request, "build_opener", side_effect=opener), contextlib.redirect_stdout(captured):
            try:
                exec(gate, {})
            except SystemExit as error:
                failed = str(error)
        assert "fixture-token-never-real" not in captured.getvalue() + (failed or "")
        if success:
            assert failed is None, failed
            assert output.read_text() == "authorized=true\n"
        else:
            assert failed is not None, "Unverified membership was admitted"
            assert not output.exists(), "Refusal retained an authorization output"
        return calls

    assert run(success=True) == ["alice", "bob"]
    assert run(overrides={"GITHUB_TRIGGERING_ACTOR": "alice"}, success=True) == ["alice"]
    assert run(overrides={"GITHUB_ACTOR": "", "GITHUB_TRIGGERING_ACTOR": "bob"}) == []
    assert run(overrides={"GITHUB_TRIGGERING_ACTOR": ""}) == []
    assert run(overrides={"MEMBERSHIP_TOKEN": ""}) == []
    for invalid_id in ["", "0", "-1", "1x"]:
        assert run(overrides={"GITHUB_ACTOR_ID": invalid_id}) == []
    run(overrides={"GITHUB_ACTOR_ID": "2"})
    for invalid in [
        member("bob", "pending"), {}, [], None, member("someone-else"),
        {**member("bob"), "organization": {"login": "outside"}},
        {**member("bob"), "user": {"login": 42}},
        *[{**member("bob"), "user": {**member("bob")["user"], **invalid_user}}
          for invalid_user in [{"type": "Bot"}, {"id": 0}, {"id": True}, {"id": "2"}, {"id": None}]],
        b"not JSON", b"\xff", b"x" * 65537,
        (404, member("bob")), (302, member("bob")),
        urllib.error.URLError("network failure fixture-token-never-real"),
    ]:
        run({"alice": member("alice"), "bob": invalid})
    run({"alice": member("alice", "pending"), "bob": member("bob")})

# Evaluate each private job's actual expression across the observable
# scheduling cases, including selective reruns that reuse cached outputs.
for job in ["git-hooks", "rust-tests", "build"]:
    block = re.search(r"^  " + job + r":\n(.*?)(?=^  [a-z][a-z0-9-]*:|\Z)", workflow, re.MULTILINE | re.DOTALL).group(1)
    expression = re.search(r"^    if: (.+)$", block, re.MULTILINE).group(1)
    for event, attempt, authorize_only, authorized, expected in [
        ("workflow_dispatch", 1, False, "true", True),
        ("workflow_dispatch", 1, False, "", False),
        ("workflow_dispatch", 1, False, "false", False),
        ("workflow_dispatch", 2, False, "true", False),
        ("workflow_dispatch", 1, True, "true", False),
        ("push", 2, False, "", True),
        ("pull_request", 2, False, "", True),
        ("merge_group", 1, False, "", True),
    ]:
        python = expression.replace("github.event_name", repr(event)).replace("github.run_attempt", str(attempt))
        python = python.replace("inputs.authorize_only", repr(authorize_only)).replace("needs.source.outputs.authorized", repr(authorized))
        python = python.replace("&&", " and ").replace("||", " or ")
        python = re.sub(r"!(?!=)", "not ", python)
        assert eval(python, {"__builtins__": {}}) == expected, (job, event, attempt, authorize_only, authorized)
print("workflow membership admission and private-job scheduling tests passed")
PY
