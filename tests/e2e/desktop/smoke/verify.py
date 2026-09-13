#!/usr/bin/env python3
"""Verify the live app's first-build checkpoint or its one committed smoke evolution."""

import argparse
import hashlib
import json
import platform
import re
import time

from smoke_support import (
    HOST,
    PROMPT,
    Locations,
    SmokeError,
    entrypoint,
    object_json,
    private_directory,
    require,
    run_output,
    write_json,
)


def git(locations, *args):
    return run_output(
        [
            str(locations.git),
            "-c",
            "core.fsmonitor=false",
            "-C",
            str(locations.config),
            *args,
        ]
    )


def integer(value, minimum=0):
    return type(value) is int and value >= minimum


def timestamp(value, earliest, latest):
    return integer(value) and earliest <= value <= latest


def state(locations):
    private_directory(locations.work)
    mission = object_json(locations.work / "mission.json")
    require(
        mission.get("schemaVersion") == 1
        and mission.get("configDir") == str(locations.config)
        and mission.get("prompt") == PROMPT
        and mission.get("host") == HOST,
        "Smoke mission does not match the app-owned contract",
    )
    now = int(time.time())
    require(
        timestamp(mission.get("startedAt"), 0, now), "Invalid smoke start timestamp"
    )
    launch = object_json(locations.work / "launch.json")
    require(
        launch.get("status") == "launched"
        and launch.get("mockSystem") is False
        and launch.get("credentialInjected") is True
        and timestamp(launch.get("startedAt"), mission["startedAt"], now),
        "A real credentialed application launch is required",
    )
    preferences = object_json(locations.state / "global-preferences.json")
    onboarding = object_json(locations.state / "onboarding-state.json")
    build = object_json(locations.state / "build-state.json").get("buildState")
    settings = object_json(locations.state / "settings.json")
    require(isinstance(build, dict), "App build state is missing")
    require(
        preferences.get("configDir") == str(locations.config)
        and preferences.get("repoRoot") == str(locations.config)
        and preferences.get("hostAttr") == HOST,
        "Nix Mac did not select the smoke configuration",
    )
    provider = mission["appProvider"]
    require(
        preferences.get("evolveProvider") == provider
        and preferences.get("evolveModels", {}).get(provider) == mission["model"],
        "Nix Mac is not using the admitted inference configuration",
    )
    for name in ("completedAt", "lastBuildAt", "macScannedAt"):
        require(
            timestamp(onboarding.get(name), mission["startedAt"], now + 5),
            "Onboarding has not recorded fresh completion, scan decision, and build",
        )
    require(onboarding.get("loginDecided") is True, "Inference decision is missing")
    require(
        timestamp(build.get("builtAt"), mission["startedAt"], now + 5),
        "App build timestamp is stale",
    )
    try:
        store = locations.system.resolve(strict=True)
    except OSError:
        raise SmokeError("No active Nix system profile exists") from None
    require(
        store.is_dir() and store.is_relative_to(locations.store_root.resolve()),
        "Active system is not a real Nix store directory",
    )
    require(
        build.get("nixmacBuiltStorePath") == str(store)
        and build.get("currentNixStorePath") == str(store),
        "App build record does not match the live activated system",
    )
    require(
        not locations.config.is_symlink()
        and (locations.config / "flake.nix").is_file(),
        "Smoke configuration is missing",
    )
    require(
        git(locations, "rev-parse", "--show-toplevel")
        == str(locations.config.resolve()),
        "Smoke configuration must own its Git repository",
    )
    head = git(locations, "rev-parse", "HEAD")
    require(re.fullmatch(r"[a-f0-9]{40,64}", head), "Invalid smoke Git commit")
    require(
        git(locations, "status", "--porcelain", "--untracked-files=normal") == "",
        "Smoke configuration has uncommitted changes",
    )
    require(
        build.get("headCommitHash") == head,
        "App build record does not identify the committed configuration",
    )
    stats = settings.get("usageStatistics", {})
    require(isinstance(stats, dict), "Invalid app usage statistics")
    return mission, onboarding, build, settings, stats, store, head, now


def checkpoint(locations):
    mission, onboarding, build, settings, stats, store, head, now = state(locations)
    require(
        stats.get("totalEvolutions", 0) == 0 and not settings.get("evolveMetadata"),
        "Onboarding checkpoint must happen before the first evolution",
    )
    require(
        not (store / "sw/bin/rg").exists(),
        "Smoke package is already installed at the initial checkpoint",
    )
    require(
        not re.search(
            r"\bripgrep\b",
            git(locations, "grep", "-I", "-h", "-e", ".", "HEAD", "--", "*.nix"),
        ),
        "Smoke package is already present in the initial configuration",
    )
    receipt = {
        "schemaVersion": 1,
        "status": "onboarding-complete",
        "capturedAt": now,
        "startedAt": mission["startedAt"],
        "head": head,
        "systemStore": str(store),
        "builtAt": build["builtAt"],
        "completedAt": onboarding["completedAt"],
        "successfulEvolutions": 0,
        "totalEvolutions": 0,
    }
    checkpoint_path = locations.work / "onboarding-checkpoint.json"
    if checkpoint_path.exists() or checkpoint_path.is_symlink():
        existing = object_json(checkpoint_path)
        require(
            timestamp(existing.get("capturedAt"), mission["startedAt"], now)
            and existing == {**receipt, "capturedAt": existing.get("capturedAt")},
            "Existing onboarding checkpoint describes a different mission, commit, or build",
        )
        return existing
    write_json(checkpoint_path, receipt, exclusive=True)
    return receipt


def evolution_proof(settings, stats, previous, now):
    require(
        stats.get("successfulEvolutions") == 1
        and stats.get("totalEvolutions") == 1
        and stats.get("failedEvolutions", 0) == 0,
        "Smoke requires exactly one successful app evolution and no failed evolutions",
    )
    metadata = settings.get("evolveMetadata")
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except ValueError:
            raise SmokeError("App evolution metadata is not valid JSON") from None
    require(isinstance(metadata, dict), "App did not retain evolution metadata")
    require(
        metadata.get("state") in ("generated", "applied", "committed")
        and metadata.get("prompt") == PROMPT
        and timestamp(metadata.get("createdAt"), previous["capturedAt"], now + 5),
        "App evolution is stale, unsuccessful, or does not match the smoke request",
    )
    require(
        integer(metadata.get("iterations"), 1)
        and integer(metadata.get("totalTokens"), 1)
        and isinstance(metadata.get("edits"), list)
        and len(metadata["edits"]) > 0,
        "App evolution lacks real provider usage or recorded edits",
    )
    calls = metadata.get("toolCalls")
    require(
        isinstance(calls, list) and len(calls) <= 1000,
        "App evolution tool evidence is missing or oversized",
    )
    successful = [
        call.get("tool")
        for call in calls
        if isinstance(call, dict) and call.get("success") is True
    ]
    require(
        any(tool in ("edit_file", "edit_nix_file") for tool in successful),
        "App evolution did not record a successful edit tool",
    )
    require(
        "build_check" in successful and integer(metadata.get("buildAttempts"), 1),
        "App evolution did not record a successful build check",
    )
    # Keep messages, arguments, output, summaries and arbitrary IDs out of the retained report.
    return {
        "createdAt": metadata["createdAt"],
        "state": metadata["state"],
        "iterations": metadata["iterations"],
        "totalTokens": metadata["totalTokens"],
        "editCount": len(metadata["edits"]),
        "buildAttempts": metadata["buildAttempts"],
        "successfulEditCalls": sum(
            tool in ("edit_file", "edit_nix_file") for tool in successful
        ),
        "successfulBuildChecks": successful.count("build_check"),
        "recordedToolCalls": len(calls),
        "promptMatches": True,
    }


def verify(locations):
    previous = object_json(locations.work / "onboarding-checkpoint.json")
    require(
        previous.get("schemaVersion") == 1
        and previous.get("status") == "onboarding-complete",
        "A verified onboarding checkpoint is required before evolution",
    )
    mission, onboarding, build, settings, stats, store, head, now = state(locations)
    require(
        previous.get("startedAt") == mission["startedAt"]
        and timestamp(previous.get("capturedAt"), mission["startedAt"], now),
        "Onboarding checkpoint belongs to a different run",
    )
    proof = evolution_proof(settings, stats, previous, now)
    require(
        head != previous.get("head")
        and git(locations, "rev-parse", "HEAD^") == previous["head"],
        "Smoke requires one new commit after the initial build",
    )
    require(
        str(store) != previous.get("systemStore")
        and timestamp(build.get("builtAt"), previous["capturedAt"], now + 5),
        "Evolution was not built and activated after the onboarding checkpoint",
    )
    changed = git(
        locations, "diff", "--name-only", "--no-ext-diff", previous["head"], head, "--"
    ).splitlines()
    require(
        changed
        and len(changed) <= 10
        and all(name.endswith(".nix") for name in changed),
        "Smoke evolution changed files outside its Nix package scope",
    )
    diff = git(
        locations,
        "diff",
        "--no-ext-diff",
        "--unified=0",
        previous["head"],
        head,
        "--",
        "*.nix",
    )
    require(
        any(
            line.startswith("+")
            and not line.startswith("+++")
            and re.search(r"\bripgrep\b", line)
            for line in diff.splitlines()
        ),
        "Committed evolution did not add the requested package",
    )
    package = store / "sw/bin/rg"
    require(package.is_file(), "Requested package is missing from the live system")
    version = run_output([str(package), "--version"], timeout=10).splitlines()[0]
    require(
        re.fullmatch(r"ripgrep [0-9][A-Za-z0-9.+() _-]{0,100}", version),
        "Installed package did not report the expected executable version",
    )
    receipt = {
        "schemaVersion": 1,
        "status": "passed",
        "verifiedAt": now,
        "provider": mission["provider"],
        "model": mission["model"],
        "inferenceProvisioned": True,
        "onboardingUiInferenceEntryTested": False,
        "onboarding": {
            "completedAt": onboarding["completedAt"],
            "initialHead": previous["head"],
            "initialStore": previous["systemStore"],
            "initialBuiltAt": previous["builtAt"],
        },
        "evolution": proof,
        "commit": {
            "head": head,
            "parent": previous["head"],
            "clean": True,
            "changedNixFiles": len(changed),
            "diffSha256": hashlib.sha256(diff.encode()).hexdigest(),
        },
        "build": {
            "builtAt": build["builtAt"],
            "activeStore": str(store),
            "packageVersion": version,
        },
        "offboardingPerformed": False,
    }
    write_json(locations.work / "verification.json", receipt)
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", action="store_true")
    args = parser.parse_args()
    require(
        platform.system() == "Darwin",
        "Smoke verification is only for a disposable macOS guest",
    )
    return (
        checkpoint(Locations.guest()) if args.checkpoint else verify(Locations.guest())
    )


if __name__ == "__main__":
    entrypoint(main)
