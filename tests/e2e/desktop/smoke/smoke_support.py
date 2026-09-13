"""App-owned smoke inputs and private guest storage; no provider secrets in reports."""

import json
import os
import stat
import subprocess
from dataclasses import dataclass
from pathlib import Path

PROMPT = (
    "Add ripgrep to environment.systemPackages in this Mac's Nix configuration. "
    "Keep all existing settings unchanged. Do not install via Homebrew. "
    "Make only this package change, run your build check, then stop for my review."
)
HOST = "desktop-test-mac"
APP_ID = "com.darkmatter.nixmac"
PROVIDERS = {
    "openai": "openai",
    "openrouter": "openrouter",
    "vllm": "openai_compatible",
}
KEY_ENV = {
    "openai": "OPENAI_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
    "vllm": "VLLM_API_KEY",
}


class SmokeError(Exception):
    """A fixed, nonsecret diagnostic suitable for the public report."""


@dataclass(frozen=True)
class Locations:
    home: Path
    work: Path
    system: Path
    app: Path
    store_root: Path = Path("/nix/store")
    git: Path = Path("/usr/bin/git")

    @classmethod
    def guest(cls):
        return cls(
            Path.home(),
            Path("/tmp/nixmac-smoke"),
            Path("/nix/var/nix/profiles/system"),
            Path("/Applications/nixmac.app"),
        )

    @property
    def state(self):
        return self.home / "Library/Application Support" / APP_ID

    @property
    def config(self):
        return self.home / "nixmac-smoke-config"


def require(condition, message):
    if not condition:
        raise SmokeError(message)


def read_json(path, limit=16 * 1024 * 1024):
    try:
        require(
            path.is_file() and not path.is_symlink(),
            "Expected regular JSON file is missing",
        )
        require(path.stat().st_size <= limit, "JSON evidence exceeds its size bound")
        with path.open(encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError, UnicodeError):
        raise SmokeError("Cannot read valid JSON evidence") from None


def object_json(path):
    value = read_json(path)
    require(isinstance(value, dict), "Expected JSON object")
    return value


def private_directory(path):
    try:
        info = path.lstat()
        require(
            stat.S_ISDIR(info.st_mode) and not path.is_symlink(),
            "Private smoke directory is not a directory",
        )
        require(
            info.st_uid == os.getuid() and stat.S_IMODE(info.st_mode) == 0o700,
            "Private smoke directory must be owned by the guest user with mode 0700",
        )
    except OSError:
        raise SmokeError("Private smoke directory is unavailable") from None


def write_json(path, value, exclusive=False):
    """Write only owner-readable JSON, refusing symlinks and existing exclusive receipts."""
    flags = os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW
    flags |= os.O_EXCL if exclusive else os.O_TRUNC
    try:
        fd = os.open(path, flags, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            os.fchmod(handle.fileno(), 0o600)
            json.dump(value, handle, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
    except (OSError, ValueError):
        raise SmokeError("Cannot persist smoke receipt") from None


def run_output(args, *, cwd=None, timeout=15):
    """Never include arbitrary child output in an error (it may contain app data)."""
    try:
        result = subprocess.run(
            args, cwd=cwd, capture_output=True, text=True, timeout=timeout, check=False
        )
    except (OSError, subprocess.SubprocessError, UnicodeError):
        raise SmokeError("Read-only evidence command did not complete") from None
    require(result.returncode == 0, "Read-only evidence command failed")
    require(
        len(result.stdout) <= 1024 * 1024,
        "Evidence command output exceeds its size bound",
    )
    return result.stdout.strip()


def app_stopped():
    try:
        result = subprocess.run(
            ["/usr/bin/pgrep", "-x", "nixmac"],
            capture_output=True,
            timeout=5,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        raise SmokeError("Cannot verify that Nix Mac is stopped") from None
    require(result.returncode == 1, "Nix Mac must be stopped before smoke preparation")


def entrypoint(operation):
    try:
        print(json.dumps(operation(), sort_keys=True))
    except SmokeError as error:
        print(json.dumps({"status": "failed", "error": str(error)}, sort_keys=True))
        raise SystemExit(1) from None
    except (OSError, ValueError, TypeError, KeyError):
        print(
            json.dumps(
                {
                    "status": "failed",
                    "error": "Smoke helper could not validate local evidence",
                }
            )
        )
        raise SystemExit(1) from None
