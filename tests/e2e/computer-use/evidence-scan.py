#!/usr/bin/env python3
"""Descriptor-relative, bounded scanner for immutable Computer Use evidence."""

import argparse
import hashlib
import json
import os
import stat
import subprocess
import sys
import tempfile
import time


CAPTURE_TEXT_PATHS = {
    "artifact/source.json",
    "attempt.json",
    "events.json",
    "index.html",
    "runner/cleanup.json",
    "runner/cleanup-probe.json",
    "runner/host-lease.json",
    "runner/identity.json",
    "runner/permissions.json",
    "state.json",
}
MANIFEST_PATH = "manifest.json"
READ_CHUNK_BYTES = 1024 * 1024
MAX_CAPTURED_TEXT_BYTES = 8 * 1024 * 1024


class ScanError(Exception):
    pass


def stable_stat(value):
    return (
        value.st_dev,
        value.st_ino,
        value.st_mode,
        value.st_size,
        value.st_mtime_ns,
        value.st_ctime_ns,
    )


def stable_directory(value):
    return (value.st_dev, value.st_ino, value.st_mode)


class Scanner:
    def __init__(self, args):
        self.args = args
        self.deadline = time.monotonic() + args.deadline_seconds
        self.files = []
        self.captured = {}
        self.manifest = None
        self.file_count = 0
        self.entry_count = 0
        self.total_bytes = 0
        self.captured_text_bytes = 0

    def check_deadline(self):
        if time.monotonic() >= self.deadline:
            raise ScanError("evidence scan deadline exceeded")

    def open_root_chain(self):
        components = [part for part in self.args.run_dir.split(os.sep) if part]
        flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
        current_fd = os.open(os.sep, flags)
        retained = [(current_fd, stable_directory(os.fstat(current_fd)), os.sep)]
        try:
            for component in components:
                self.check_deadline()
                before = os.stat(component, dir_fd=current_fd, follow_symlinks=False)
                if not stat.S_ISDIR(before.st_mode):
                    raise ScanError(
                        f"evidence path component is not a direct directory: {component}"
                    )
                child_fd = os.open(component, flags, dir_fd=current_fd)
                opened = os.fstat(child_fd)
                if stable_directory(before) != stable_directory(opened):
                    os.close(child_fd)
                    raise ScanError(
                        f"evidence path component changed while opening: {component}"
                    )
                if stable_directory(os.fstat(current_fd)) != retained[-1][1]:
                    os.close(child_fd)
                    raise ScanError(
                        f"evidence parent directory changed during traversal: {component}"
                    )
                retained.append((child_fd, stable_directory(opened), component))
                current_fd = child_fd
            return retained
        except Exception:
            for fd, _, _ in reversed(retained):
                os.close(fd)
            raise

    def validate_media(self, file_fd, relative_path, prefix):
        is_png = relative_path.lower().endswith(".png")
        is_mp4 = relative_path == "video/computer-use-evidence.mp4"
        if not is_png and not is_mp4:
            return
        if is_png and prefix[:8] != b"\x89PNG\r\n\x1a\n":
            raise ScanError(f"PNG evidence has invalid magic bytes: {relative_path}")
        if is_mp4 and (len(prefix) < 12 or prefix[4:8] != b"ftyp"):
            raise ScanError(f"MP4 evidence has invalid magic bytes: {relative_path}")

        os.lseek(file_fd, 0, os.SEEK_SET)
        fd_path = (
            f"/dev/fd/{file_fd}"
            if sys.platform == "darwin"
            else f"/proc/self/fd/{file_fd}"
        )
        remaining = max(0.1, self.deadline - time.monotonic())
        with tempfile.TemporaryFile() as error_output:
            process = subprocess.Popen(
                [
                    self.args.ffmpeg,
                    "-v",
                    "error",
                    "-nostdin",
                    "-i",
                    fd_path,
                    "-map",
                    "0:v:0",
                    "-f",
                    "null",
                    "-",
                ],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=error_output,
                pass_fds=(file_fd,),
            )
            try:
                status = process.wait(timeout=remaining)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
                raise ScanError(f"media decode deadline exceeded: {relative_path}")
            if status != 0:
                error_output.seek(0)
                detail = error_output.read(8192).decode("utf-8", "replace").strip()
                raise ScanError(
                    f"media decode failed for {relative_path}: {detail or 'ffmpeg rejected it'}"
                )
        self.check_deadline()

    def scan_file(self, directory_fd, name, relative_path, before, include_record=True):
        flags = os.O_RDONLY | os.O_NOFOLLOW
        file_fd = os.open(name, flags, dir_fd=directory_fd)
        try:
            opened = os.fstat(file_fd)
            if stable_stat(before) != stable_stat(opened) or not stat.S_ISREG(opened.st_mode):
                raise ScanError(f"evidence file changed while opening: {relative_path}")
            if opened.st_size <= 0:
                raise ScanError(f"required evidence file is empty: {relative_path}")
            if opened.st_size > self.args.max_file_bytes:
                raise ScanError(
                    f"evidence file exceeds per-file limit: {relative_path}"
                )
            if self.total_bytes + opened.st_size > self.args.max_total_bytes:
                raise ScanError("evidence tree exceeds total-byte limit")

            digest = hashlib.sha256()
            observed_bytes = 0
            prefix = b""
            captured = (
                bytearray()
                if relative_path in CAPTURE_TEXT_PATHS or relative_path == MANIFEST_PATH
                else None
            )
            while True:
                self.check_deadline()
                chunk = os.read(file_fd, READ_CHUNK_BYTES)
                if not chunk:
                    break
                if len(prefix) < 32:
                    prefix += chunk[: 32 - len(prefix)]
                digest.update(chunk)
                observed_bytes += len(chunk)
                if observed_bytes > self.args.max_file_bytes:
                    raise ScanError(
                        f"evidence file exceeds per-file limit: {relative_path}"
                    )
                if captured is not None:
                    if self.captured_text_bytes + len(chunk) > MAX_CAPTURED_TEXT_BYTES:
                        raise ScanError("captured evidence metadata exceeds total limit")
                    captured.extend(chunk)
                    self.captured_text_bytes += len(chunk)
            after = os.fstat(file_fd)
            if (
                stable_stat(opened) != stable_stat(after)
                or observed_bytes != opened.st_size
            ):
                raise ScanError(f"evidence file changed while hashing: {relative_path}")
            self.validate_media(file_fd, relative_path, prefix)
            if stable_stat(opened) != stable_stat(os.fstat(file_fd)):
                raise ScanError(f"evidence file changed while decoding: {relative_path}")
            self.total_bytes += observed_bytes
            if captured is not None:
                try:
                    text = bytes(captured).decode("utf-8")
                except UnicodeDecodeError as error:
                    raise ScanError(
                        f"captured evidence metadata is not UTF-8: {relative_path}"
                    ) from error
                self.captured[relative_path] = text
            if include_record:
                self.files.append(
                    {
                        "path": relative_path,
                        "sha256": digest.hexdigest(),
                        "bytes": observed_bytes,
                    }
                )
            else:
                self.manifest = bytes(captured or b"").decode("utf-8")
        finally:
            os.close(file_fd)

    def walk(self, directory_fd, relative_directory=""):
        self.check_deadline()
        directory_before = stable_directory(os.fstat(directory_fd))
        names = []
        with os.scandir(directory_fd) as entries:
            for entry in entries:
                self.entry_count += 1
                if self.entry_count > self.args.max_entries:
                    raise ScanError("evidence tree exceeds entry-count limit")
                names.append(entry.name)
        names.sort()
        for name in names:
            self.check_deadline()
            if not name or "/" in name or "\x00" in name:
                raise ScanError("evidence directory contains an invalid entry name")
            relative_path = (
                f"{relative_directory}/{name}" if relative_directory else name
            )
            before = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
            if stat.S_ISLNK(before.st_mode):
                raise ScanError(
                    f"evidence tree must not contain symlink: {relative_path}"
                )
            if stat.S_ISDIR(before.st_mode):
                child_fd = os.open(
                    name,
                    os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                    dir_fd=directory_fd,
                )
                try:
                    opened = os.fstat(child_fd)
                    if stable_directory(before) != stable_directory(opened):
                        raise ScanError(
                            f"evidence directory changed while opening: {relative_path}"
                        )
                    self.walk(child_fd, relative_path)
                    if stable_directory(opened) != stable_directory(os.fstat(child_fd)):
                        raise ScanError(
                            f"evidence directory changed during traversal: {relative_path}"
                        )
                finally:
                    os.close(child_fd)
            elif stat.S_ISREG(before.st_mode):
                if relative_path == MANIFEST_PATH:
                    if self.args.mode == "create":
                        raise ScanError(
                            "manifest.json already exists; verified evidence is immutable"
                        )
                    self.scan_file(
                        directory_fd,
                        name,
                        relative_path,
                        before,
                        include_record=False,
                    )
                    continue
                self.file_count += 1
                if self.file_count > self.args.max_files:
                    raise ScanError("evidence tree exceeds file-count limit")
                self.scan_file(directory_fd, name, relative_path, before)
            else:
                raise ScanError(
                    f"evidence tree contains unsupported filesystem entry: {relative_path}"
                )
            if stable_directory(os.fstat(directory_fd)) != directory_before:
                raise ScanError(
                    f"evidence directory changed during traversal: {relative_directory or '.'}"
                )

    def run(self):
        retained = self.open_root_chain()
        try:
            root_fd = retained[-1][0]
            self.walk(root_fd)
            for fd, expected, label in retained:
                if stable_directory(os.fstat(fd)) != expected:
                    raise ScanError(
                        f"evidence path component changed during scan: {label}"
                    )
        finally:
            for fd, _, _ in reversed(retained):
                os.close(fd)
        if self.args.mode == "verify" and self.manifest is None:
            raise ScanError("required evidence file is missing: manifest.json")
        self.files.sort(key=lambda item: item["path"])
        return {
            "files": self.files,
            "captured": self.captured,
            "manifest": self.manifest,
            "fileCount": self.file_count,
            "totalBytes": self.total_bytes,
        }


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-dir", required=True)
    parser.add_argument("--mode", choices=("create", "verify"), required=True)
    parser.add_argument("--ffmpeg", required=True)
    parser.add_argument("--max-files", type=int, required=True)
    parser.add_argument("--max-entries", type=int, required=True)
    parser.add_argument("--max-file-bytes", type=int, required=True)
    parser.add_argument("--max-total-bytes", type=int, required=True)
    parser.add_argument("--deadline-seconds", type=float, required=True)
    args = parser.parse_args()
    if not os.path.isabs(args.run_dir) or os.path.normpath(args.run_dir) != args.run_dir:
        parser.error("run directory must be an absolute normalized path")
    return args


def main():
    try:
        result = Scanner(parse_args()).run()
        json.dump(result, sys.stdout, separators=(",", ":"))
        sys.stdout.write("\n")
    except (OSError, ScanError, ValueError) as error:
        sys.stderr.write(f"evidence scan failed: {error}\n")
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
