#!/usr/bin/env python3
"""Descriptor-relative, bounded scanner for immutable Computer Use evidence."""

import argparse
import hashlib
import json
import os
import posixpath
import secrets
import stat
import subprocess
import sys
import tempfile
import time
import zipfile


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
MAX_FFPROBE_OUTPUT_BYTES = 1024 * 1024
MAX_VIDEO_WIDTH = 4096
MAX_VIDEO_HEIGHT = 4096
MAX_VIDEO_PIXELS = 4096 * 2304
MAX_VIDEO_DURATION_SECONDS = 3600
MAX_VIDEO_FRAMES = 432000
FIXED_ZIP_TIMESTAMP = (1980, 1, 1, 0, 0, 0)
FIXED_ZIP_MODE = stat.S_IFREG | 0o600
MAX_ARCHIVE_OVERHEAD_BYTES = 4 * 1024 * 1024


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


def stable_directory_contents(value):
    return (
        value.st_dev,
        value.st_ino,
        value.st_mode,
        value.st_size,
        value.st_mtime_ns,
        value.st_ctime_ns,
    )


def stable_archive_binding(value):
    return (
        value.st_dev,
        value.st_ino,
        value.st_mode,
        value.st_size,
        value.st_mtime_ns,
    )


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
        self.archive_spool = tempfile.TemporaryFile() if args.archive_out else None
        self.archive_records = []
        self.archive = None

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
        if is_mp4:
            self.validate_video_inventory(file_fd, fd_path, relative_path)
            os.lseek(file_fd, 0, os.SEEK_SET)
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

    def validate_video_inventory(self, file_fd, fd_path, relative_path):
        remaining = max(0.1, self.deadline - time.monotonic())
        with tempfile.TemporaryFile() as probe_output, tempfile.TemporaryFile() as error_output:
            process = subprocess.Popen(
                [
                    self.args.ffprobe,
                    "-v",
                    "error",
                    "-count_frames",
                    "-show_streams",
                    "-show_format",
                    "-show_chapters",
                    "-print_format",
                    "json",
                    fd_path,
                ],
                stdin=subprocess.DEVNULL,
                stdout=probe_output,
                stderr=error_output,
                pass_fds=(file_fd,),
            )
            try:
                status = process.wait(timeout=remaining)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
                raise ScanError(f"media inventory deadline exceeded: {relative_path}")
            output_bytes = os.fstat(probe_output.fileno()).st_size
            if status != 0:
                error_output.seek(0)
                detail = error_output.read(8192).decode("utf-8", "replace").strip()
                raise ScanError(
                    f"media inventory failed for {relative_path}: "
                    f"{detail or 'ffprobe rejected it'}"
                )
            if output_bytes <= 0 or output_bytes > MAX_FFPROBE_OUTPUT_BYTES:
                raise ScanError(f"media inventory output is outside bounds: {relative_path}")
            probe_output.seek(0)
            try:
                inventory = json.loads(probe_output.read().decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as error:
                raise ScanError(
                    f"media inventory is invalid JSON: {relative_path}"
                ) from error

        streams = inventory.get("streams")
        chapters = inventory.get("chapters", [])
        media_format = inventory.get("format")
        if (
            not isinstance(streams, list)
            or len(streams) != 1
            or not isinstance(chapters, list)
            or len(chapters) != 0
            or not isinstance(media_format, dict)
        ):
            raise ScanError(
                f"video evidence must contain exactly one video stream and no chapters: {relative_path}"
            )
        stream = streams[0]
        if not isinstance(stream, dict):
            raise ScanError(f"video stream inventory is invalid: {relative_path}")
        disposition = stream.get("disposition", {})
        if (
            stream.get("codec_type") != "video"
            or not isinstance(disposition, dict)
            or disposition.get("attached_pic", 0) not in (0, "0")
        ):
            raise ScanError(
                f"video evidence contains a forbidden audio, data, attachment, or non-video stream: "
                f"{relative_path}"
            )
        width = stream.get("width")
        height = stream.get("height")
        if (
            not isinstance(width, int)
            or isinstance(width, bool)
            or not isinstance(height, int)
            or isinstance(height, bool)
            or width <= 0
            or height <= 0
            or width > MAX_VIDEO_WIDTH
            or height > MAX_VIDEO_HEIGHT
            or width * height > MAX_VIDEO_PIXELS
        ):
            raise ScanError(f"video dimensions exceed the evidence contract: {relative_path}")
        duration_source = stream.get("duration", media_format.get("duration"))
        try:
            duration = float(duration_source)
        except (TypeError, ValueError) as error:
            raise ScanError(f"video duration is missing or invalid: {relative_path}") from error
        if (
            not duration > 0
            or not duration <= MAX_VIDEO_DURATION_SECONDS
            or duration == float("inf")
        ):
            raise ScanError(f"video duration exceeds the evidence contract: {relative_path}")
        frame_source = stream.get("nb_read_frames", stream.get("nb_frames"))
        try:
            frames = int(frame_source)
        except (TypeError, ValueError) as error:
            raise ScanError(f"video frame count is missing or invalid: {relative_path}") from error
        if str(frames) != str(frame_source) or frames < 1 or frames > MAX_VIDEO_FRAMES:
            raise ScanError(f"video frame count exceeds the evidence contract: {relative_path}")
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
            archive_offset = (
                self.archive_spool.tell() if self.archive_spool is not None else None
            )
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
                if self.archive_spool is not None:
                    self.archive_spool.write(chunk)
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
            if self.archive_spool is not None:
                self.archive_records.append(
                    {
                        "path": relative_path,
                        "offset": archive_offset,
                        "bytes": observed_bytes,
                    }
                )
        finally:
            os.close(file_fd)

    def walk(self, directory_fd, relative_directory=""):
        self.check_deadline()
        directory_before = stable_directory_contents(os.fstat(directory_fd))
        names = []
        with os.scandir(directory_fd) as entries:
            for entry in entries:
                self.entry_count += 1
                if self.entry_count > self.args.max_entries:
                    raise ScanError("evidence tree exceeds entry-count limit")
                names.append(entry.name)
        names.sort()
        expected_entries = {}
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
                    if stable_directory_contents(opened) != stable_directory_contents(
                        os.fstat(child_fd)
                    ):
                        raise ScanError(
                            f"evidence directory changed during traversal: {relative_path}"
                        )
                    expected_entries[name] = stable_stat(os.fstat(child_fd))
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
                    expected_entries[name] = stable_stat(
                        os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
                    )
                    continue
                self.file_count += 1
                if self.file_count > self.args.max_files:
                    raise ScanError("evidence tree exceeds file-count limit")
                self.scan_file(directory_fd, name, relative_path, before)
                expected_entries[name] = stable_stat(
                    os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
                )
            else:
                raise ScanError(
                    f"evidence tree contains unsupported filesystem entry: {relative_path}"
                )
            if stable_directory_contents(os.fstat(directory_fd)) != directory_before:
                raise ScanError(
                    f"evidence directory changed during traversal: {relative_directory or '.'}"
                )
        final_names = []
        with os.scandir(directory_fd) as entries:
            for entry in entries:
                final_names.append(entry.name)
        final_names.sort()
        if final_names != names:
            raise ScanError(
                f"evidence directory entry set changed during traversal: "
                f"{relative_directory or '.'}"
            )
        for name in final_names:
            current = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
            if stable_stat(current) != expected_entries[name]:
                relative_path = (
                    f"{relative_directory}/{name}" if relative_directory else name
                )
                raise ScanError(
                    f"evidence entry changed during final revalidation: {relative_path}"
                )
        if stable_directory_contents(os.fstat(directory_fd)) != directory_before:
            raise ScanError(
                f"evidence directory changed during final revalidation: "
                f"{relative_directory or '.'}"
            )

    def write_archive(self, parent_fd):
        if self.archive_spool is None or not self.args.archive_out:
            return None
        archive_name = os.path.basename(self.args.archive_out)
        records = sorted(self.archive_records, key=lambda item: item["path"])
        paths = [record["path"] for record in records]
        if len(paths) != len(set(paths)):
            raise ScanError("canonical archive input contains duplicate paths")
        if MANIFEST_PATH not in paths:
            raise ScanError("canonical archive input is missing manifest.json")
        temporary_name = (
            f".{archive_name}.tmp-{os.getpid()}-{secrets.token_hex(16)}"
        )
        flags = os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
        archive_fd = os.open(temporary_name, flags, 0o600, dir_fd=parent_fd)
        published = False
        try:
            with os.fdopen(os.dup(archive_fd), "w+b") as archive_file:
                with zipfile.ZipFile(
                    archive_file,
                    mode="w",
                    compression=zipfile.ZIP_STORED,
                    allowZip64=True,
                    strict_timestamps=True,
                ) as archive:
                    archive.comment = b""
                    for record in records:
                        self.check_deadline()
                        info = zipfile.ZipInfo(record["path"], FIXED_ZIP_TIMESTAMP)
                        info.compress_type = zipfile.ZIP_STORED
                        info.create_system = 3
                        info.external_attr = FIXED_ZIP_MODE << 16
                        info.extra = b""
                        info.comment = b""
                        self.archive_spool.seek(record["offset"])
                        remaining = record["bytes"]
                        with archive.open(info, mode="w", force_zip64=False) as entry:
                            while remaining:
                                self.check_deadline()
                                chunk = self.archive_spool.read(
                                    min(READ_CHUNK_BYTES, remaining)
                                )
                                if not chunk:
                                    raise ScanError(
                                        f"canonical archive spool ended early: {record['path']}"
                                    )
                                entry.write(chunk)
                                remaining -= len(chunk)
                archive_file.flush()
                os.fsync(archive_file.fileno())

            archive_stat = os.fstat(archive_fd)
            if (
                not stat.S_ISREG(archive_stat.st_mode)
                or archive_stat.st_size <= 0
                or archive_stat.st_size
                > self.args.max_total_bytes + MAX_ARCHIVE_OVERHEAD_BYTES
            ):
                raise ScanError("canonical archive exceeds its bounded output contract")
            digest = hashlib.sha256()
            observed_bytes = 0
            os.lseek(archive_fd, 0, os.SEEK_SET)
            while True:
                self.check_deadline()
                chunk = os.read(archive_fd, READ_CHUNK_BYTES)
                if not chunk:
                    break
                digest.update(chunk)
                observed_bytes += len(chunk)
            if (
                observed_bytes != archive_stat.st_size
                or stable_stat(archive_stat) != stable_stat(os.fstat(archive_fd))
            ):
                raise ScanError("canonical archive changed while hashing")
            os.link(
                temporary_name,
                archive_name,
                src_dir_fd=parent_fd,
                dst_dir_fd=parent_fd,
                follow_symlinks=False,
            )
            published = True
            published_stat = os.stat(
                archive_name, dir_fd=parent_fd, follow_symlinks=False
            )
            if stable_archive_binding(published_stat) != stable_archive_binding(
                archive_stat
            ):
                raise ScanError("canonical archive binding changed while publishing")
            os.unlink(temporary_name, dir_fd=parent_fd)
            os.fsync(parent_fd)
            return {
                "path": self.args.archive_out,
                "sha256": digest.hexdigest(),
                "bytes": observed_bytes,
                "entryCount": len(records),
            }
        finally:
            os.close(archive_fd)
            if not published:
                try:
                    os.unlink(temporary_name, dir_fd=parent_fd)
                except FileNotFoundError:
                    pass

    def run(self):
        retained = self.open_root_chain()
        try:
            root_fd = retained[-1][0]
            self.walk(root_fd)
            for index, (fd, expected, label) in enumerate(retained):
                if stable_directory(os.fstat(fd)) != expected:
                    raise ScanError(
                        f"evidence path component changed during scan: {label}"
                    )
                if index > 0:
                    parent_fd = retained[index - 1][0]
                    rebound = os.stat(label, dir_fd=parent_fd, follow_symlinks=False)
                    if stable_directory(rebound) != expected:
                        raise ScanError(
                            f"evidence path component binding changed during scan: {label}"
                        )
            if self.archive_spool is not None:
                if len(retained) < 2:
                    raise ScanError("canonical archive requires an evidence parent directory")
                self.archive = self.write_archive(retained[-2][0])
        finally:
            for fd, _, _ in reversed(retained):
                os.close(fd)
            if self.archive_spool is not None:
                self.archive_spool.close()
        if self.args.mode == "verify" and self.manifest is None:
            raise ScanError("required evidence file is missing: manifest.json")
        self.files.sort(key=lambda item: item["path"])
        return {
            "files": self.files,
            "captured": self.captured,
            "manifest": self.manifest,
            "fileCount": self.file_count,
            "totalBytes": self.total_bytes,
            "archive": self.archive,
        }


def validate_archive_entry_path(relative_path):
    if (
        not relative_path
        or relative_path.startswith("/")
        or "\\" in relative_path
        or "\x00" in relative_path
        or relative_path == "."
        or relative_path.startswith("./")
        or posixpath.normpath(relative_path) != relative_path
        or ".." in relative_path.split("/")
    ):
        raise ScanError(
            f"canonical archive contains an invalid evidence path: {relative_path}"
        )


def open_direct_file_chain(file_path):
    components = [part for part in file_path.split(os.sep) if part]
    if not components:
        raise ScanError("canonical archive path is invalid")
    directory_components = components[:-1]
    file_name = components[-1]
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    current_fd = os.open(os.sep, flags)
    retained = [(current_fd, stable_directory(os.fstat(current_fd)), os.sep)]
    file_fd = None
    try:
        for component in directory_components:
            before = os.stat(component, dir_fd=current_fd, follow_symlinks=False)
            if not stat.S_ISDIR(before.st_mode):
                raise ScanError(
                    f"canonical archive path component is not a direct directory: {component}"
                )
            child_fd = os.open(component, flags, dir_fd=current_fd)
            opened = os.fstat(child_fd)
            if stable_directory(before) != stable_directory(opened):
                os.close(child_fd)
                raise ScanError(
                    f"canonical archive path component changed while opening: {component}"
                )
            retained.append((child_fd, stable_directory(opened), component))
            current_fd = child_fd
        before = os.stat(file_name, dir_fd=current_fd, follow_symlinks=False)
        file_fd = os.open(file_name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=current_fd)
        opened = os.fstat(file_fd)
        if stable_stat(before) != stable_stat(opened) or not stat.S_ISREG(
            opened.st_mode
        ):
            raise ScanError("canonical archive changed while opening")
        return retained, file_fd, opened, file_name
    except Exception:
        if file_fd is not None:
            os.close(file_fd)
        for fd, _, _ in reversed(retained):
            os.close(fd)
        raise


class ArchiveVerifier:
    def __init__(self, args):
        self.args = args
        self.deadline = time.monotonic() + args.deadline_seconds

    def check_deadline(self):
        if time.monotonic() >= self.deadline:
            raise ScanError("canonical archive verification deadline exceeded")

    def hash_archive(self, archive_fd, expected_stat):
        digest = hashlib.sha256()
        observed_bytes = 0
        os.lseek(archive_fd, 0, os.SEEK_SET)
        while True:
            self.check_deadline()
            chunk = os.read(archive_fd, READ_CHUNK_BYTES)
            if not chunk:
                break
            digest.update(chunk)
            observed_bytes += len(chunk)
            if (
                observed_bytes
                > self.args.max_total_bytes + MAX_ARCHIVE_OVERHEAD_BYTES
            ):
                raise ScanError("canonical archive exceeds its bounded size contract")
        if (
            observed_bytes != expected_stat.st_size
            or stable_stat(expected_stat) != stable_stat(os.fstat(archive_fd))
        ):
            raise ScanError("canonical archive changed while hashing")
        return digest.hexdigest(), observed_bytes

    def extract(self, archive_fd, extraction_root):
        total_bytes = 0
        seen = set()
        with os.fdopen(os.dup(archive_fd), "rb") as archive_file:
            with zipfile.ZipFile(archive_file, mode="r") as archive:
                if archive.comment != b"":
                    raise ScanError("canonical archive comment must be empty")
                infos = archive.infolist()
                if len(infos) > self.args.max_files + 1:
                    raise ScanError("canonical archive exceeds file-count limit")
                if len(infos) > self.args.max_entries:
                    raise ScanError("canonical archive exceeds entry-count limit")
                names = [info.filename for info in infos]
                if names != sorted(names):
                    raise ScanError(
                        "canonical archive entries are not in stable lexical order"
                    )
                for info in infos:
                    self.check_deadline()
                    validate_archive_entry_path(info.filename)
                    if info.filename in seen:
                        raise ScanError(
                            f"canonical archive contains duplicate path: {info.filename}"
                        )
                    seen.add(info.filename)
                    unix_mode = (info.external_attr >> 16) & 0xFFFF
                    if (
                        info.is_dir()
                        or info.date_time != FIXED_ZIP_TIMESTAMP
                        or info.compress_type != zipfile.ZIP_STORED
                        or info.create_system != 3
                        or unix_mode != FIXED_ZIP_MODE
                        or info.extra != b""
                        or info.comment != b""
                        or info.flag_bits != 0
                        or info.file_size <= 0
                        or info.file_size > self.args.max_file_bytes
                        or info.compress_size != info.file_size
                    ):
                        raise ScanError(
                            f"canonical archive entry metadata is not fixed: {info.filename}"
                        )
                    if total_bytes + info.file_size > self.args.max_total_bytes:
                        raise ScanError("canonical archive exceeds total-byte limit")
                    target = os.path.join(
                        extraction_root, *info.filename.split("/")
                    )
                    os.makedirs(os.path.dirname(target), mode=0o700, exist_ok=True)
                    target_fd = os.open(
                        target,
                        os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                        0o600,
                    )
                    observed = 0
                    try:
                        with archive.open(info, mode="r") as source:
                            while True:
                                self.check_deadline()
                                chunk = source.read(READ_CHUNK_BYTES)
                                if not chunk:
                                    break
                                observed += len(chunk)
                                if observed > info.file_size:
                                    raise ScanError(
                                        f"canonical archive entry exceeds declared size: {info.filename}"
                                    )
                                os.write(target_fd, chunk)
                        os.fsync(target_fd)
                    finally:
                        os.close(target_fd)
                    if observed != info.file_size:
                        raise ScanError(
                            f"canonical archive entry size mismatch: {info.filename}"
                        )
                    total_bytes += observed
                if MANIFEST_PATH not in seen:
                    raise ScanError("canonical archive is missing manifest.json")
        return total_bytes, len(seen)

    def run(self):
        retained, archive_fd, expected_stat, file_name = open_direct_file_chain(
            self.args.archive
        )
        extraction_root = None
        try:
            archive_stat = os.fstat(archive_fd)
            archive_sha256, archive_bytes = self.hash_archive(
                archive_fd, archive_stat
            )
            extraction_root = os.path.realpath(
                tempfile.mkdtemp(prefix="nixmac-canonical-evidence-")
            )
            extracted_bytes, entry_count = self.extract(
                archive_fd, extraction_root
            )
            remaining = max(0.1, self.deadline - time.monotonic())
            scan_args = argparse.Namespace(
                **{
                    **vars(self.args),
                    "archive": None,
                    "archive_out": None,
                    "mode": "verify",
                    "run_dir": extraction_root,
                    "deadline_seconds": remaining,
                }
            )
            scan = Scanner(scan_args).run()
            if scan["totalBytes"] != extracted_bytes:
                raise ScanError(
                    "canonical archive extracted byte count does not match verified evidence"
                )
            if stable_stat(os.fstat(archive_fd)) != stable_stat(expected_stat):
                raise ScanError("canonical archive changed during verification")
            for index, (fd, expected, label) in enumerate(retained):
                if stable_directory(os.fstat(fd)) != expected:
                    raise ScanError(
                        f"canonical archive path component changed during verification: {label}"
                    )
                if index > 0:
                    rebound = os.stat(
                        label,
                        dir_fd=retained[index - 1][0],
                        follow_symlinks=False,
                    )
                    if stable_directory(rebound) != expected:
                        raise ScanError(
                            f"canonical archive path binding changed during verification: {label}"
                        )
            rebound_file = os.stat(
                file_name, dir_fd=retained[-1][0], follow_symlinks=False
            )
            if stable_stat(rebound_file) != stable_stat(expected_stat):
                raise ScanError(
                    "canonical archive file binding changed during verification"
                )
            scan["archive"] = {
                "path": self.args.archive,
                "sha256": archive_sha256,
                "bytes": archive_bytes,
                "entryCount": entry_count,
            }
            return scan
        except zipfile.BadZipFile as error:
            raise ScanError(f"canonical archive ZIP validation failed: {error}") from error
        finally:
            os.close(archive_fd)
            for fd, _, _ in reversed(retained):
                os.close(fd)
            if extraction_root is not None:
                import shutil

                shutil.rmtree(extraction_root)


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-dir")
    parser.add_argument(
        "--mode", choices=("create", "verify", "archive-verify"), required=True
    )
    parser.add_argument("--archive")
    parser.add_argument("--archive-out")
    parser.add_argument("--ffmpeg", required=True)
    parser.add_argument("--ffprobe", required=True)
    parser.add_argument("--max-files", type=int, required=True)
    parser.add_argument("--max-entries", type=int, required=True)
    parser.add_argument("--max-file-bytes", type=int, required=True)
    parser.add_argument("--max-total-bytes", type=int, required=True)
    parser.add_argument("--deadline-seconds", type=float, required=True)
    args = parser.parse_args()
    if args.mode == "archive-verify":
        if (
            args.run_dir
            or args.archive_out
            or not args.archive
            or not os.path.isabs(args.archive)
            or os.path.normpath(args.archive) != args.archive
        ):
            parser.error(
                "archive verification requires one absolute normalized --archive path"
            )
    else:
        if (
            not args.run_dir
            or args.archive
            or not os.path.isabs(args.run_dir)
            or os.path.normpath(args.run_dir) != args.run_dir
        ):
            parser.error("run directory must be an absolute normalized path")
        if args.archive_out:
            if (
                args.mode != "verify"
                or not os.path.isabs(args.archive_out)
                or os.path.normpath(args.archive_out) != args.archive_out
                or os.path.dirname(args.archive_out) != os.path.dirname(args.run_dir)
                or args.archive_out == args.run_dir
            ):
                parser.error(
                    "archive output must be an absolute normalized sibling of the verified run directory"
                )
    return args


def main():
    try:
        args = parse_args()
        result = (
            ArchiveVerifier(args).run()
            if args.mode == "archive-verify"
            else Scanner(args).run()
        )
        json.dump(result, sys.stdout, separators=(",", ":"))
        sys.stdout.write("\n")
    except (OSError, ScanError, ValueError) as error:
        sys.stderr.write(f"evidence scan failed: {error}\n")
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
