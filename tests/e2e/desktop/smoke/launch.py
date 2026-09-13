#!/usr/bin/env python3
"""Launch once with a private credential file; no credentials appear in argv or output."""

import os
import platform
import select
import stat
import time

from smoke_support import (
    KEY_ENV,
    Locations,
    SmokeError,
    app_stopped,
    entrypoint,
    object_json,
    private_directory,
    require,
    write_json,
)


def read_private_key(path):
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, "rb") as handle:
            info = os.fstat(handle.fileno())
            require(
                stat.S_ISREG(info.st_mode)
                and info.st_uid == os.getuid()
                and stat.S_IMODE(info.st_mode) == 0o600
                and info.st_nlink == 1,
                "Provider key must be a guest-owned regular file with mode 0600",
            )
            require(0 < info.st_size <= 16384, "Provider key has an invalid size")
            key = handle.read(16385).decode("utf-8").strip()
            require(
                key and not any(ord(char) < 33 or ord(char) == 127 for char in key),
                "Provider key must be one nonempty token",
            )
            return key
    except (OSError, UnicodeError):
        raise SmokeError("Cannot read the private provider key") from None


def spawn_detached(executable, environment, log):
    """A close-on-exec pipe confirms exec without retaining a Python child handle."""
    read_fd, write_fd = os.pipe()
    try:
        pid = os.fork()
    except OSError:
        os.close(read_fd)
        os.close(write_fd)
        raise
    if pid == 0:
        os.close(read_fd)
        try:
            os.setsid()
            stdin = os.open(os.devnull, os.O_RDONLY)
            os.dup2(stdin, 0)
            os.dup2(log.fileno(), 1)
            os.dup2(log.fileno(), 2)
            os.execve(str(executable), [str(executable)], environment)
        except OSError:
            os.write(write_fd, b"failed")
            os._exit(127)
    os.close(write_fd)
    try:
        ready, _, _ = select.select([read_fd], [], [], 10)
        require(ready, "Application exec was not confirmed; do not replay launch")
        result = os.read(read_fd, 16)
        if result:
            os.waitpid(pid, 0)
            raise SmokeError("Application exec failed; use a fresh disposable guest")
        return pid
    finally:
        os.close(read_fd)


def launch(locations):
    private_directory(locations.work)
    mission = object_json(locations.work / "mission.json")
    provider = mission.get("provider")
    require(provider in KEY_ENV, "Smoke mission has an unsupported provider")
    executable = locations.app / "Contents/MacOS/nixmac"
    require(
        executable.is_file() and os.access(executable, os.X_OK),
        "Verified Nix Mac executable is missing",
    )
    key = read_private_key(locations.work / "provider-key")
    # Inherit only desktop/runtime basics. No debug, mock, hermetic or unrelated provider override.
    names = (
        "HOME",
        "USER",
        "LOGNAME",
        "SHELL",
        "PATH",
        "TMPDIR",
        "LANG",
        "LC_ALL",
        "__CF_USER_TEXT_ENCODING",
    )
    environment = {name: os.environ[name] for name in names if name in os.environ}
    environment["HOME"] = str(locations.home)
    environment[KEY_ENV[provider]] = key
    if provider == "vllm":
        environment["VLLM_API_BASE"] = mission["baseUrl"]
    write_json(
        locations.work / "launch-attempt.json",
        {"startedAt": int(time.time())},
        exclusive=True,
    )
    try:
        fd = os.open(
            locations.work / "private-app.log",
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            0o600,
        )
        with os.fdopen(fd, "wb") as log:
            pid = spawn_detached(executable, environment, log)
        receipt = {
            "status": "launched",
            "pid": pid,
            "startedAt": int(time.time()),
            "provider": provider,
            "credentialInjected": True,
            "mockSystem": False,
        }
        write_json(locations.work / "launch.json", receipt, exclusive=True)
        # The real process now owns its environment; do not retain a reusable plaintext token.
        (locations.work / "provider-key").unlink()
        return receipt
    except OSError:
        raise SmokeError(
            "Application launch was not confirmed; do not replay it in this guest"
        ) from None


def main():
    require(
        platform.system() == "Darwin",
        "Smoke launch is only for a disposable macOS guest",
    )
    app_stopped()
    return launch(Locations.guest())


if __name__ == "__main__":
    entrypoint(main)
