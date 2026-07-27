import base64
import hashlib
import os
import re
import signal
import stat
import subprocess
import sys
import time

lease_root, lease_dir, quarantine_file = sys.argv[1:]
SAFE_NAME = re.compile(r"^[A-Za-z0-9._-]+$")
VOLATILE = {"heartbeat", "heartbeat.pid", "heartbeat.log"}
OPEN_FLAGS = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
DIR_FLAGS = OPEN_FLAGS | getattr(os, "O_DIRECTORY", 0)


def open_directory(path, label):
    try:
        fd = os.open(path, DIR_FLAGS)
    except FileNotFoundError:
        return None
    except OSError as error:
        raise SystemExit(f"unsafe {label}: {error}")
    metadata = os.fstat(fd)
    if not stat.S_ISDIR(metadata.st_mode):
        os.close(fd)
        raise SystemExit(f"unsafe {label}: not a directory")
    named = os.lstat(path)
    if stat.S_ISLNK(named.st_mode) or (named.st_dev, named.st_ino) != (
        metadata.st_dev,
        metadata.st_ino,
    ):
        os.close(fd)
        raise SystemExit(f"unsafe {label}: path identity mismatch")
    return fd


def open_regular_at(directory_fd, name, label, required=True):
    try:
        named = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
    except FileNotFoundError:
        if not required:
            return None, None
        raise SystemExit(f"{label} changed during status read; retry") from None
    if not stat.S_ISREG(named.st_mode):
        raise SystemExit(f"unsafe {label}: not a regular file")
    if named.st_size > 1_048_576:
        raise SystemExit(f"unsafe {label}: file exceeds size limit")
    try:
        fd = os.open(name, OPEN_FLAGS, dir_fd=directory_fd)
    except FileNotFoundError:
        if not required:
            return None, None
        raise SystemExit(f"{label} changed during status read; retry") from None
    opened = os.fstat(fd)
    if (named.st_dev, named.st_ino) != (opened.st_dev, opened.st_ino):
        os.close(fd)
        raise SystemExit(f"unsafe {label}: file identity mismatch")
    return fd, opened


def read_bounded(fd):
    os.lseek(fd, 0, os.SEEK_SET)
    payload = b""
    while len(payload) <= 1_048_576:
        chunk = os.read(fd, min(65_536, 1_048_577 - len(payload)))
        if not chunk:
            return payload
        payload += chunk
    raise SystemExit("lease metadata exceeds size limit")


def canonical_digest(directory_fd):
    names = sorted(os.listdir(directory_fd))
    if len(names) > 32:
        raise SystemExit("lease directory exceeds entry limit")
    records = bytearray()
    for name in names:
        if not SAFE_NAME.fullmatch(name):
            raise SystemExit(f"unsafe lease entry name: {name}")
        fd, metadata = open_regular_at(directory_fd, name, f"lease entry {name}")
        try:
            if name in VOLATILE:
                records.extend(f"{len(name)}\t{name}\tvolatile-runtime-file\n".encode())
            else:
                digest = hashlib.sha256(read_bounded(fd)).hexdigest()
                records.extend(
                    f"{len(name)}\t{name}\t{metadata.st_size}\t{digest}\n".encode()
                )
        finally:
            os.close(fd)
    return hashlib.sha256(records).hexdigest()


def heartbeat_process_matches(heartbeat_pid):
    heartbeat_script = os.path.join(lease_dir, "heartbeat.sh")
    ps_path = "/bin/ps"
    if (
        os.environ.get("NIXMAC_E2E_LEASE_TEST_MODE") == "1"
        and os.environ.get("NIXMAC_E2E_LEASE_PS_PATH")
    ):
        ps_path = os.environ["NIXMAC_E2E_LEASE_PS_PATH"]
    try:
        process = subprocess.run(
            [ps_path, "-ww", "-p", str(heartbeat_pid), "-o", "command="],
            check=False,
            capture_output=True,
            text=True,
            timeout=2,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise SystemExit(f"unable to validate orphan heartbeat: {error}")
    if process.returncode == 0:
        return heartbeat_script in process.stdout
    if process.returncode == 1:
        return False
    raise SystemExit(
        "unable to validate orphan heartbeat: "
        f"process probe failed with status {process.returncode}"
    )


def stop_validated_heartbeat(directory_fd):
    heartbeat_pid_fd, _ = open_regular_at(
        directory_fd, "heartbeat.pid", "heartbeat pid", required=False
    )
    if heartbeat_pid_fd is None:
        return
    try:
        raw_pid = read_bounded(heartbeat_pid_fd)
    finally:
        os.close(heartbeat_pid_fd)
    try:
        heartbeat_pid = int(raw_pid.decode("ascii").strip())
    except (UnicodeDecodeError, ValueError):
        return
    if heartbeat_pid <= 1:
        return
    if not heartbeat_process_matches(heartbeat_pid):
        return
    try:
        os.kill(heartbeat_pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    except OSError as error:
        raise SystemExit(f"unable to stop orphan heartbeat: {error}")
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        if not heartbeat_process_matches(heartbeat_pid):
            return
        time.sleep(0.05)
    raise SystemExit("orphan heartbeat did not stop after SIGTERM")


root_fd = open_directory(lease_root, "lease root")
if root_fd is None:
    print("FREE")
    raise SystemExit(0)
try:
    owner_name = os.path.basename(lease_dir)
    quarantine_name = os.path.basename(quarantine_file)
    try:
        owner_fd = os.open(owner_name, DIR_FLAGS, dir_fd=root_fd)
    except FileNotFoundError:
        owner_fd = None
    except OSError as error:
        raise SystemExit(f"unsafe lease owner directory: {error}")
    if owner_fd is None:
        quarantine_fd, _ = open_regular_at(
            root_fd, quarantine_name, "quarantine metadata", required=False
        )
        if quarantine_fd is None:
            print("FREE")
        else:
            try:
                payload = read_bounded(quarantine_fd)
            finally:
                os.close(quarantine_fd)
            print(
                "QUARANTINED",
                hashlib.sha256(payload).hexdigest(),
                base64.b64encode(payload).decode(),
                sep="\t",
            )
        raise SystemExit(0)
    try:
        owner_stat = os.fstat(owner_fd)
        named_owner = os.stat(owner_name, dir_fd=root_fd, follow_symlinks=False)
        if not stat.S_ISDIR(named_owner.st_mode) or (
            named_owner.st_dev,
            named_owner.st_ino,
        ) != (owner_stat.st_dev, owner_stat.st_ino):
            raise SystemExit("unsafe lease owner directory: path identity mismatch")
        digest = canonical_digest(owner_fd)
        owner_json_fd, _ = open_regular_at(
            owner_fd, "owner.json", "owner metadata", required=False
        )
        if owner_json_fd is None:
            stop_validated_heartbeat(owner_fd)
            print("AMBIGUOUS", digest, "missing-owner-metadata", sep="\t")
            raise SystemExit(0)
        try:
            owner_payload = read_bounded(owner_json_fd)
        finally:
            os.close(owner_json_fd)
        quarantine_payload = b""
        quarantine_fd, _ = open_regular_at(
            root_fd, quarantine_name, "quarantine metadata", required=False
        )
        if quarantine_fd is not None:
            try:
                quarantine_payload = read_bounded(quarantine_fd)
            finally:
                os.close(quarantine_fd)
        print(
            "OCCUPIED",
            digest,
            base64.b64encode(owner_payload).decode(),
            base64.b64encode(quarantine_payload).decode(),
            sep="\t",
        )
    finally:
        os.close(owner_fd)
finally:
    os.close(root_fd)
