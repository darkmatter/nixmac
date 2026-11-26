#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# Execute the actual workflow-owned permission check with a mocked HTTP
# boundary. This test never creates a token or contacts GitHub.
python3 - "$REPO_ROOT/.github/workflows/build.yaml" "$REPO_ROOT/.github/workflows/storybook.yaml" <<'PY'
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

def evaluate(expression, context):
    expression = expression.strip().removeprefix("${{").removesuffix("}}").strip()
    for key, value in context.items():
        expression = expression.replace(key, repr(value))
    expression = expression.replace("&&", " and ").replace("||", " or ")
    expression = re.sub(r"!(?!=)", "not ", expression).strip()
    return eval(expression, {"__builtins__": {}, "fromJSON": json.loads, "always": lambda: True})

def expression_in(block, key, default=None):
    match = re.search(r"^ +" + key + r": (.+)$", block, re.MULTILINE)
    return match[1] if match else default

# Evaluate each private job's actual expression across the observable
# scheduling cases, including selective reruns that reuse cached outputs.
for job in ["git-hooks", "rust-tests", "build"]:
    block = re.search(r"^  " + job + r":\n(.*?)(?=^  [a-z][a-z0-9-]*:|\Z)", workflow, re.MULTILINE | re.DOTALL).group(1)
    expression = expression_in(block, "if")
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
        context = {
            "github.event_name": event,
            "github.run_attempt": attempt,
            "inputs.authorize_only": authorize_only,
            "needs.source.outputs.authorized": authorized,
        }
        assert evaluate(expression, context) == expected, (job, event, attempt, authorize_only, authorized)
print("workflow membership admission and private-job scheduling tests passed")

# Exercise the workflow expressions with the event payloads GitHub supplies.
# A fork must get the check steps even though it cannot receive signing or
# deployment credentials; trusted events must keep their existing paths.
def step_enabled(job, name, context):
    block = re.split(r"\n      - name: ", job.split(f"\n      - name: {name}\n", 1)[1], maxsplit=1)[0]
    return bool(evaluate(expression_in(block, "if", "True"), context))

mac = workflow.split("\n  build:\n", 1)[1]
storybook = Path(sys.argv[2]).read_text()
for event, head, actor, triggering_actor, trusted in [
    ("pull_request", "contributor/nixmac", "contributor", "contributor", False),
    ("pull_request", "darkmatter/nixmac", "dependabot[bot]", "dependabot[bot]", False),
    ("pull_request", "darkmatter/nixmac", "dependabot[bot]", "maintainer", False),
    ("pull_request", "darkmatter/nixmac", "maintainer", "maintainer", True),
    ("push", "", "maintainer", "maintainer", True),
    ("merge_group", "", "maintainer", "maintainer", True),
    ("workflow_dispatch", "", "maintainer", "maintainer", True),
]:
    context = {
        "github.actor": actor,
        "github.triggering_actor": triggering_actor,
        "github.event_name": event,
        "github.event.pull_request.head.repo.full_name": head,
        "github.repository": "darkmatter/nixmac",
    }
    assert evaluate(expression_in(workflow, "trusted"), context) == trusted, event
    context.update({
        "needs.source.outputs.trusted": str(trusted).lower(),
        "secrets.SOPS_AGE_KEY": "fixture-signing-key",
        "steps.check-secrets.outputs.has_certificate": "true",
    })
    assert evaluate(expression_in(mac, "runs-on"), context) == (
        ["self-hosted", "macOS", "ARM64"] if trusted else ["macos-15"]
    ), event
    assert bool(evaluate(expression_in(mac, "SOPS_AGE_KEY"), context)) == trusted, event
    for step_name in [
        "Check for code signing secrets", "Build Tauri app", "Import Apple Developer certificate",
        "Normalize macOS system install names", "Sign app bundle", "Install DMG Finder layout metadata",
        "Notarize app", "Check macOS app portability", "Write exact build provenance",
        "Upload DMG artifact", "Upload app bundle artifact", "Cleanup keychain",
    ]:
        assert step_enabled(mac, step_name, context) == trusted, (event, head, step_name)
    assert step_enabled(mac, "Build unsigned Tauri app", context) != trusted, event
    assert step_enabled(mac, "Verify artifacts carry the production profile", context), event
    assert step_enabled(mac, "Unit Test frontend", context), event

    if event in ("pull_request", "push"):
        context["steps.deploy.outputs.deployment-url"] = "https://fixture.pages.dev" if trusted else ""
        assert evaluate(expression_in(storybook, "runs-on"), context) == ("arc" if trusted else "ubuntu-24.04")
        for step_name in ["Resolve secrets", "Create Cloudflare Pages project (if needed)",
                          "Deploy to Cloudflare Pages", "Publish Storybook deployment link"]:
            assert step_enabled(storybook, step_name, context) == trusted, (event, head, step_name)
        assert step_enabled(storybook, "Mint darkmatter[bot] token", context) == (trusted and event == "pull_request")
        assert step_enabled(storybook, "Run Storybook snapshot tests", context), event
print("fork, Dependabot, and trusted workflow scheduling tests passed")
PY
