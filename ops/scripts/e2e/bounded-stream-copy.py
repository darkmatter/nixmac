#!/usr/bin/env python3
"""Atomically copy stdin to a file without ever writing beyond a byte limit."""

from __future__ import annotations

import os
import sys
import tempfile
from io import BytesIO
from pathlib import Path


def bounded_copy(source, destination: Path, max_bytes: int) -> int:
    if max_bytes < 1:
        raise ValueError("max_bytes must be positive")
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = None
    total = 0
    try:
        with tempfile.NamedTemporaryFile(
            dir=destination.parent,
            prefix=f".{destination.name}.",
            delete=False,
        ) as output:
            temporary_path = Path(output.name)
            while True:
                chunk = source.read(min(64 * 1024, max_bytes - total + 1))
                if not chunk:
                    break
                total += len(chunk)
                if total > max_bytes:
                    raise ValueError(f"input exceeds {max_bytes} bytes")
                output.write(chunk)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary_path, destination)
        temporary_path = None
        return total
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def self_test() -> None:
    with tempfile.TemporaryDirectory(prefix="nixmac-bounded-copy-") as temporary:
        destination = Path(temporary) / "nested" / "evidence.bin"
        if bounded_copy(BytesIO(b"1234"), destination, 4) != 4:
            raise AssertionError("bounded copy returned the wrong size")
        if destination.read_bytes() != b"1234":
            raise AssertionError("bounded copy changed the payload")
        try:
            bounded_copy(BytesIO(b"12345"), destination, 4)
        except ValueError:
            pass
        else:
            raise AssertionError("bounded copy accepted oversized input")
        if destination.read_bytes() != b"1234":
            raise AssertionError("oversized input replaced the previous destination")


def main() -> None:
    if sys.argv[1:] == ["--self-test"]:
        self_test()
        print("bounded stream copy self-test passed")
        return
    if len(sys.argv) != 3:
        raise SystemExit(f"Usage: {sys.argv[0]} <destination> <max-bytes>")
    try:
        max_bytes = int(sys.argv[2])
        bounded_copy(sys.stdin.buffer, Path(sys.argv[1]), max_bytes)
    except (OSError, ValueError) as error:
        raise SystemExit(f"bounded-stream-copy: {error}") from error


if __name__ == "__main__":
    main()
