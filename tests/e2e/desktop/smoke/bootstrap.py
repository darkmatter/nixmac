#!/usr/bin/env python3
"""Prepare genuine fresh onboarding with provisioned inference, without a token argument."""

import argparse
import platform
import re
import time
from urllib.parse import urlsplit

from smoke_support import (
    HOST,
    PROMPT,
    PROVIDERS,
    Locations,
    app_stopped,
    entrypoint,
    object_json,
    private_directory,
    require,
    write_json,
)


def bootstrap(locations, provider, model, base_url=None):
    require(provider in PROVIDERS, "Unsupported smoke provider")
    require(
        isinstance(model, str)
        and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}", model),
        "Model must be a nonsecret provider model identifier",
    )
    if provider == "vllm":
        require(
            isinstance(base_url, str) and len(base_url) <= 2048,
            "Compatible provider requires a base URL",
        )
        url = urlsplit(base_url)
        require(
            url.scheme in ("http", "https")
            and url.hostname
            and not url.username
            and not url.password
            and not url.query
            and not url.fragment,
            "Provider URL must contain no credentials, query, or fragment",
        )
    else:
        require(base_url in (None, ""), "Base URL is only supported for vllm")

    require(
        not locations.config.exists() and not locations.config.is_symlink(),
        "Smoke configuration destination must not exist",
    )
    require(
        not locations.work.exists() and not locations.work.is_symlink(),
        "Smoke was already prepared; use a fresh disposable guest",
    )
    require(
        not locations.state.is_symlink(),
        "Application state directory must not be a symlink",
    )
    preferences_path = locations.state / "global-preferences.json"
    onboarding_path = locations.state / "onboarding-state.json"
    preferences = object_json(preferences_path) if preferences_path.exists() else {}
    onboarding = object_json(onboarding_path) if onboarding_path.exists() else {}
    require(
        preferences.get("configDir") is None
        and preferences.get("repoRoot") is None
        and onboarding.get("completedAt") is None
        and onboarding.get("lastBuildAt") is None,
        "Smoke requires a fresh onboarding image or the fresh onboarding fixture",
    )
    helper = preferences.get("helperPreference", "unset")
    require(
        helper in ("unset", "granted", "disabled"),
        "Unrecognized existing helper preference",
    )

    locations.work.mkdir(mode=0o700)
    private_directory(locations.work)
    locations.state.mkdir(parents=True, exist_ok=True)
    app_provider = PROVIDERS[provider]
    prefs = {
        "configDir": None,
        "repoRoot": None,
        "hostAttr": None,
        "evolveProvider": app_provider,
        "summaryProvider": app_provider,
        "evolveModels": {app_provider: model},
        "summaryModels": {app_provider: model},
        "sendDiagnostics": False,
        "diagnosticsNoticeAcknowledged": True,
        "scanHomebrewOnStartup": False,
        "autoSummarizeOnFocus": False,
        "confirmBuild": True,
        "helperPreference": helper,
    }
    if base_url:
        prefs["openaiCompatibleApiBaseUrl"] = base_url
    slices = {
        "global-preferences.json": prefs,
        "onboarding-state.json": {
            "completedAt": None,
            "lastBuildAt": None,
            "macScannedAt": None,
            "loginDecided": True,
            "provisionalConfigDir": None,
        },
        "evolve-state.json": {},
        "build-state.json": {"buildState": {}},
        "settings.json": {"globalPreferencesMigratedV1": True},
        "query-cache.json": {},
    }
    for name, value in slices.items():
        write_json(locations.state / name, value)
    mission = {
        "schemaVersion": 1,
        "startedAt": int(time.time()),
        "provider": provider,
        "appProvider": app_provider,
        "model": model,
        "baseUrl": base_url,
        "host": HOST,
        "configDir": str(locations.config),
        "prompt": PROMPT,
        "package": "ripgrep",
        "inferenceProvisioned": True,
        "onboardingUiInferenceEntryTested": False,
        "initialSystemStore": str(locations.system.resolve())
        if locations.system.exists()
        else None,
    }
    write_json(locations.work / "mission.json", mission, exclusive=True)
    return {"status": "prepared", "mission": mission}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--provider", choices=list(PROVIDERS), required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--base-url")
    args = parser.parse_args()
    require(
        platform.system() == "Darwin",
        "Smoke bootstrap is only for a disposable macOS guest",
    )
    app_stopped()
    return bootstrap(Locations.guest(), args.provider, args.model, args.base_url)


if __name__ == "__main__":
    entrypoint(main)
