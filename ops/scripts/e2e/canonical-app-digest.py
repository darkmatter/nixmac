#!/usr/bin/env python3
"""Compute a transport-stable digest for a complete macOS application bundle."""

from __future__ import annotations

import hashlib
import os
import stat
import struct
import sys
import tempfile
from pathlib import Path

SCHEMA = b"nixmac.app.canonical.v1"


def add_field(digest, value: bytes) -> None:
    digest.update(struct.pack(">Q", len(value)))
    digest.update(value)


def app_digest(root: Path) -> str:
    root = root.resolve(strict=True)
    if not root.is_dir():
        raise ValueError("application bundle path must be a directory")
    digest = hashlib.sha256()
    add_field(digest, SCHEMA)

    def visit(directory: Path, relative: Path) -> None:
        entries = sorted(os.scandir(directory), key=lambda entry: os.fsencode(entry.name))
        for entry in entries:
            entry_relative = relative / entry.name
            relative_bytes = entry_relative.as_posix().encode("utf-8")
            metadata = entry.stat(follow_symlinks=False)
            mode = metadata.st_mode
            if stat.S_ISLNK(mode):
                add_field(digest, b"symlink")
                add_field(digest, relative_bytes)
                add_field(digest, os.readlink(entry.path).encode("utf-8"))
            elif stat.S_ISDIR(mode):
                add_field(digest, b"directory")
                add_field(digest, relative_bytes)
                visit(Path(entry.path), entry_relative)
            elif stat.S_ISREG(mode):
                file_digest = hashlib.sha256()
                with open(entry.path, "rb") as handle:
                    for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                        file_digest.update(chunk)
                add_field(digest, b"file")
                add_field(digest, relative_bytes)
                add_field(digest, str(mode & 0o111).encode("ascii"))
                add_field(digest, str(metadata.st_size).encode("ascii"))
                add_field(digest, file_digest.digest())
            else:
                raise ValueError(f"unsupported bundle entry type: {entry_relative.as_posix()}")

    visit(root, Path())
    return digest.hexdigest()


def self_test() -> None:
    with tempfile.TemporaryDirectory(prefix="nixmac-app-digest-") as temporary:
        root = Path(temporary) / "nixmac.app"
        executable = root / "Contents" / "MacOS" / "nixmac"
        executable.parent.mkdir(parents=True)
        executable.write_bytes(b"one")
        executable.chmod(0o755)
        link = root / "Contents" / "Resources" / "current"
        link.parent.mkdir(parents=True)
        link.symlink_to("../MacOS/nixmac")
        original = app_digest(root)
        if app_digest(root) != original:
            raise AssertionError("canonical app digest must be deterministic")
        executable.write_bytes(b"two")
        if app_digest(root) == original:
            raise AssertionError("canonical app digest must include file contents")
        executable.write_bytes(b"one")
        executable.chmod(0o644)
        if app_digest(root) == original:
            raise AssertionError("canonical app digest must include executable mode")
        executable.chmod(0o755)
        link.unlink()
        link.symlink_to("../MacOS/other")
        if app_digest(root) == original:
            raise AssertionError("canonical app digest must include symlink targets")


def main() -> None:
    if sys.argv[1:] == ["--self-test"]:
        self_test()
        print("canonical app digest self-test passed")
        return
    if len(sys.argv) != 2:
        raise SystemExit(f"Usage: {sys.argv[0]} <nixmac.app path>")
    print(app_digest(Path(sys.argv[1])))


if __name__ == "__main__":
    main()
