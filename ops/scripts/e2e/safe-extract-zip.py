#!/usr/bin/env python3
"""Extract a ZIP atomically with path, entry-count, and expansion bounds."""

from __future__ import annotations

import os
import shutil
import stat
import sys
import tempfile
import zipfile
from io import BytesIO
from pathlib import Path, PurePosixPath


def safe_extract(
    archive_path: Path,
    destination: Path,
    max_total_bytes: int,
    max_entries: int,
    max_file_bytes: int,
) -> None:
    if min(max_total_bytes, max_entries, max_file_bytes) < 1:
        raise ValueError("all extraction limits must be positive")
    if destination.exists():
        raise ValueError("destination must not already exist")
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary_root = Path(
        tempfile.mkdtemp(prefix=f".{destination.name}.", dir=destination.parent),
    )
    extraction_root = temporary_root / "payload"
    extraction_root.mkdir()
    try:
        with zipfile.ZipFile(archive_path) as archive:
            entries = archive.infolist()
            if not entries or len(entries) > max_entries:
                raise ValueError(f"archive must contain 1-{max_entries} entries")

            advertised_total = 0
            normalized_names: set[str] = set()
            validated: list[tuple[zipfile.ZipInfo, PurePosixPath, bool]] = []
            for entry in entries:
                if "\\" in entry.filename or "\x00" in entry.filename:
                    raise ValueError(f"unsafe archive path: {entry.filename!r}")
                relative = PurePosixPath(entry.filename)
                if (
                    relative.is_absolute()
                    or not relative.parts
                    or any(part in {"", ".", ".."} for part in relative.parts)
                ):
                    raise ValueError(f"unsafe archive path: {entry.filename!r}")
                normalized = relative.as_posix().rstrip("/").casefold()
                if not normalized or normalized in normalized_names:
                    raise ValueError(f"duplicate archive path: {entry.filename!r}")
                normalized_names.add(normalized)

                unix_mode = (entry.external_attr >> 16) & 0xFFFF
                file_type = stat.S_IFMT(unix_mode)
                is_directory = entry.is_dir()
                if file_type == stat.S_IFLNK:
                    raise ValueError(f"archive symlinks are not allowed: {entry.filename!r}")
                if file_type not in {0, stat.S_IFREG, stat.S_IFDIR}:
                    raise ValueError(f"unsupported archive entry type: {entry.filename!r}")
                if entry.flag_bits & 0x1:
                    raise ValueError(f"encrypted archive entry is not allowed: {entry.filename!r}")
                if (is_directory and file_type == stat.S_IFREG) or (
                    not is_directory and file_type == stat.S_IFDIR
                ):
                    raise ValueError(f"inconsistent archive entry type: {entry.filename!r}")
                if is_directory and entry.file_size != 0:
                    raise ValueError(f"directory has file content: {entry.filename!r}")
                if not is_directory:
                    if entry.file_size > max_file_bytes:
                        raise ValueError(f"archive entry exceeds file limit: {entry.filename!r}")
                    advertised_total += entry.file_size
                    if advertised_total > max_total_bytes:
                        raise ValueError("archive exceeds total expansion limit")
                validated.append((entry, relative, is_directory))

            extracted_total = 0
            for entry, relative, is_directory in validated:
                target = extraction_root.joinpath(*relative.parts)
                if is_directory:
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                file_total = 0
                with archive.open(entry) as source, target.open("xb") as output:
                    while True:
                        chunk = source.read(64 * 1024)
                        if not chunk:
                            break
                        file_total += len(chunk)
                        extracted_total += len(chunk)
                        if file_total > max_file_bytes or extracted_total > max_total_bytes:
                            raise ValueError("archive exceeded extraction limits while streaming")
                        output.write(chunk)
                if file_total != entry.file_size:
                    raise ValueError(f"archive entry size mismatch: {entry.filename!r}")

        os.replace(extraction_root, destination)
    finally:
        shutil.rmtree(temporary_root, ignore_errors=True)


def self_test() -> None:
    with tempfile.TemporaryDirectory(prefix="nixmac-safe-zip-") as temporary:
        root = Path(temporary)
        valid = root / "valid.zip"
        with zipfile.ZipFile(valid, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("nixmac.app/Contents/Info.plist", b"plist")
            archive.writestr("nixmac.app/Contents/MacOS/nixmac", b"binary")
        extracted = root / "valid"
        safe_extract(valid, extracted, 64, 10, 32)
        if (extracted / "nixmac.app/Contents/MacOS/nixmac").read_bytes() != b"binary":
            raise AssertionError("safe extraction changed a valid archive")

        traversal = root / "traversal.zip"
        with zipfile.ZipFile(traversal, "w") as archive:
            archive.writestr("../escape", b"bad")
        try:
            safe_extract(traversal, root / "traversal", 64, 10, 32)
        except ValueError:
            pass
        else:
            raise AssertionError("safe extraction accepted path traversal")

        expanded = root / "expanded.zip"
        with zipfile.ZipFile(expanded, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("large", BytesIO(b"x" * 65).getvalue())
        try:
            safe_extract(expanded, root / "expanded", 64, 10, 64)
        except ValueError:
            pass
        else:
            raise AssertionError("safe extraction accepted oversized expansion")


def main() -> None:
    if sys.argv[1:] == ["--self-test"]:
        self_test()
        print("safe ZIP extraction self-test passed")
        return
    if len(sys.argv) != 6:
        raise SystemExit(
            f"Usage: {sys.argv[0]} <archive.zip> <destination> "
            "<max-total-bytes> <max-entries> <max-file-bytes>",
        )
    try:
        safe_extract(
            Path(sys.argv[1]),
            Path(sys.argv[2]),
            int(sys.argv[3]),
            int(sys.argv[4]),
            int(sys.argv[5]),
        )
    except (OSError, ValueError, zipfile.BadZipFile, zipfile.LargeZipFile) as error:
        raise SystemExit(f"safe-extract-zip: {error}") from error


if __name__ == "__main__":
    main()
