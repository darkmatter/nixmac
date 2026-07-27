import base64
import datetime
import hashlib
import os
import re
import signal
import stat
import subprocess
import sys
import time

(
    lease_root,
    lease_dir,
    quarantine_file,
    recovery_audit_root,
    expected_digest,
    reason_b64,
    lease_state,
    recovery_test_hook,
) = sys.argv[1:]
SAFE_NAME = re.compile(r"^[A-Za-z0-9._-]+$")
VOLATILE = {"heartbeat", "heartbeat.pid", "heartbeat.log"}
OPEN_FLAGS = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
DIR_FLAGS = OPEN_FLAGS | getattr(os, "O_DIRECTORY", 0)


def fail(message, code=65):
    print(message, file=sys.stderr)
    raise SystemExit(code)


def open_directory(path, label):
    try:
        fd = os.open(path, DIR_FLAGS)
    except OSError as error:
        fail(f"unsafe {label}: {error}")
    opened = os.fstat(fd)
    try:
        named = os.lstat(path)
    except OSError as error:
        os.close(fd)
        fail(f"unsafe {label}: {error}")
    if (
        not stat.S_ISDIR(opened.st_mode)
        or stat.S_ISLNK(named.st_mode)
        or (named.st_dev, named.st_ino) != (opened.st_dev, opened.st_ino)
    ):
        os.close(fd)
        fail(f"unsafe {label}: path identity mismatch")
    return fd


def open_directory_at(parent_fd, name, label):
    try:
        fd = os.open(name, DIR_FLAGS, dir_fd=parent_fd)
    except OSError as error:
        fail(f"unsafe {label}: {error}")
    opened = os.fstat(fd)
    named = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
    if (
        not stat.S_ISDIR(named.st_mode)
        or (named.st_dev, named.st_ino) != (opened.st_dev, opened.st_ino)
    ):
        os.close(fd)
        fail(f"unsafe {label}: path identity mismatch")
    return fd, opened


def open_regular_at(parent_fd, name, label, required=True):
    try:
        named = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
    except FileNotFoundError:
        if required:
            fail(f"{label} disappeared")
        return None, None
    if not stat.S_ISREG(named.st_mode) or named.st_size > 1_048_576:
        fail(f"unsafe {label}")
    try:
        fd = os.open(name, OPEN_FLAGS, dir_fd=parent_fd)
    except OSError as error:
        fail(f"unsafe {label}: {error}")
    opened = os.fstat(fd)
    if (named.st_dev, named.st_ino) != (opened.st_dev, opened.st_ino):
        os.close(fd)
        fail(f"unsafe {label}: file identity mismatch")
    return fd, opened


def read_bounded(fd):
    os.lseek(fd, 0, os.SEEK_SET)
    payload = bytearray()
    while len(payload) <= 1_048_576:
        chunk = os.read(fd, min(65_536, 1_048_577 - len(payload)))
        if not chunk:
            return bytes(payload)
        payload.extend(chunk)
    fail("lease metadata exceeds size limit")


def canonical_digest(directory_fd):
    names = sorted(os.listdir(directory_fd))
    if len(names) > 32:
        fail("lease directory exceeds entry limit")
    records = bytearray()
    for name in names:
        if not SAFE_NAME.fullmatch(name):
            fail(f"unsafe lease entry name: {name}")
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


def assert_named_identity(parent_fd, name, held_stat, label):
    try:
        named = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
    except OSError as error:
        fail(f"{label} identity changed: {error}")
    if (named.st_dev, named.st_ino) != (held_stat.st_dev, held_stat.st_ino):
        fail(f"{label} identity changed during recovery")


def assert_path_identity(path, held_stat, label):
    try:
        named = os.lstat(path)
    except OSError as error:
        fail(f"{label} identity changed: {error}")
    if (
        stat.S_ISLNK(named.st_mode)
        or (named.st_dev, named.st_ino) != (held_stat.st_dev, held_stat.st_ino)
    ):
        fail(f"{label} identity changed during recovery")


def ensure_audit_root():
    try:
        os.mkdir(recovery_audit_root, 0o700)
    except FileExistsError:
        pass
    return open_directory(recovery_audit_root, "recovery audit root")


def write_new_file(parent_fd, name, payload):
    flags = (
        os.O_WRONLY
        | os.O_CREAT
        | os.O_EXCL
        | getattr(os, "O_CLOEXEC", 0)
        | getattr(os, "O_NOFOLLOW", 0)
    )
    fd = os.open(name, flags, 0o600, dir_fd=parent_fd)
    try:
        view = memoryview(payload)
        while view:
            written = os.write(fd, view)
            view = view[written:]
        os.fsync(fd)
    finally:
        os.close(fd)


def reserve_audit_directory(audit_root_fd):
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    stem = f"{stamp}-{expected_digest}"
    for suffix in range(1000):
        name = stem if suffix == 0 else f"{stem}-{suffix}"
        try:
            os.mkdir(name, 0o700, dir_fd=audit_root_fd)
        except FileExistsError:
            continue
        audit_fd, _ = open_directory_at(audit_root_fd, name, "recovery audit directory")
        return name, audit_fd
    fail("unable to reserve unique recovery audit directory")


def process_is_active():
    pattern = (
        r"nixmac\.app/Contents/MacOS/nixmac|/Contents/MacOS/nixmac|"
        r"[c]ua-driver|[C]uaDriver\.app/Contents/MacOS"
    )
    return subprocess.run(
        ["pgrep", "-f", pattern],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    ).returncode == 0


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
        fail(f"unable to validate recovery heartbeat: {error}")
    if process.returncode == 0:
        return heartbeat_script in process.stdout
    if process.returncode == 1:
        return False
    fail(
        "unable to validate recovery heartbeat: "
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
        fail("recovery heartbeat PID is invalid")
    if heartbeat_pid <= 1:
        fail("recovery heartbeat PID is invalid")
    if not heartbeat_process_matches(heartbeat_pid):
        return
    try:
        os.kill(heartbeat_pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    except OSError as error:
        fail(f"unable to stop recovery heartbeat: {error}")
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        if not heartbeat_process_matches(heartbeat_pid):
            return
        time.sleep(0.05)
    fail("recovery heartbeat did not stop after SIGTERM", 73)


root_fd = open_directory(lease_root, "lease root")
root_stat = os.fstat(root_fd)
owner_fd = None
quarantine_fd = None
audit_root_fd = None
audit_fd = None
try:
    owner_name = os.path.basename(lease_dir)
    quarantine_name = os.path.basename(quarantine_file)
    if lease_state == "QUARANTINED":
        try:
            os.stat(owner_name, dir_fd=root_fd, follow_symlinks=False)
        except FileNotFoundError:
            pass
        else:
            fail("marker-only quarantine gained a lease directory")
        quarantine_fd, quarantine_stat = open_regular_at(
            root_fd, quarantine_name, "quarantine metadata"
        )
        initial_quarantine = read_bounded(quarantine_fd)
        if hashlib.sha256(initial_quarantine).hexdigest() != expected_digest:
            fail("quarantine digest changed during recovery")
    else:
        owner_fd, owner_stat = open_directory_at(
            root_fd, owner_name, "lease owner directory"
        )
        if canonical_digest(owner_fd) != expected_digest:
            fail("lease digest changed during recovery")
        owner_json_fd, _ = open_regular_at(
            owner_fd, "owner.json", "owner metadata", required=lease_state == "OCCUPIED"
        )
        if owner_json_fd is not None:
            os.close(owner_json_fd)
        elif lease_state != "AMBIGUOUS":
            fail("owner metadata disappeared")
        quarantine_fd, quarantine_stat = open_regular_at(
            root_fd, quarantine_name, "quarantine metadata", required=False
        )
        initial_quarantine = (
            read_bounded(quarantine_fd) if quarantine_fd is not None else None
        )

    if process_is_active():
        fail("nixmac or CuaDriver process active; refusing recovery", 73)

    if owner_fd is not None:
        stop_validated_heartbeat(owner_fd)

    if recovery_test_hook:
        subprocess.run([recovery_test_hook, lease_root], check=True)

    audit_root_fd = ensure_audit_root()
    audit_name, audit_fd = reserve_audit_directory(audit_root_fd)
    write_new_file(
        audit_fd, "operator-reason.txt", base64.b64decode(reason_b64, validate=True)
    )
    write_new_file(audit_fd, "lease-state.txt", f"{lease_state}\n".encode())
    write_new_file(
        audit_fd, "observed-lease-digest.txt", f"{expected_digest}\n".encode()
    )
    assert_path_identity(lease_root, root_stat, "lease root")

    if lease_state == "QUARANTINED":
        assert_named_identity(
            root_fd, quarantine_name, quarantine_stat, "quarantine metadata"
        )
        if hashlib.sha256(read_bounded(quarantine_fd)).hexdigest() != expected_digest:
            fail("quarantine digest changed before recovery move")
        os.rename(
            quarantine_name,
            "QUARANTINED.json",
            src_dir_fd=root_fd,
            dst_dir_fd=audit_fd,
        )
        moved = os.stat("QUARANTINED.json", dir_fd=audit_fd, follow_symlinks=False)
        if (moved.st_dev, moved.st_ino) != (
            quarantine_stat.st_dev,
            quarantine_stat.st_ino,
        ):
            try:
                os.stat(quarantine_name, dir_fd=root_fd, follow_symlinks=False)
            except FileNotFoundError:
                os.rename(
                    "QUARANTINED.json",
                    quarantine_name,
                    src_dir_fd=audit_fd,
                    dst_dir_fd=root_fd,
                )
            fail("quarantine identity changed during recovery move")
        if hashlib.sha256(read_bounded(quarantine_fd)).hexdigest() != expected_digest:
            try:
                os.rename(
                    "QUARANTINED.json",
                    quarantine_name,
                    src_dir_fd=audit_fd,
                    dst_dir_fd=root_fd,
                )
            finally:
                fail("quarantine digest changed during recovery move")
    else:
        assert_named_identity(root_fd, owner_name, owner_stat, "lease owner directory")
        if canonical_digest(owner_fd) != expected_digest:
            fail("lease digest changed before recovery move")
        os.rename(owner_name, "lease", src_dir_fd=root_fd, dst_dir_fd=audit_fd)
        moved = os.stat("lease", dir_fd=audit_fd, follow_symlinks=False)
        if (moved.st_dev, moved.st_ino) != (owner_stat.st_dev, owner_stat.st_ino):
            try:
                os.stat(owner_name, dir_fd=root_fd, follow_symlinks=False)
            except FileNotFoundError:
                os.rename("lease", owner_name, src_dir_fd=audit_fd, dst_dir_fd=root_fd)
            fail("lease owner identity changed during recovery move")
        if canonical_digest(owner_fd) != expected_digest:
            try:
                os.stat(owner_name, dir_fd=root_fd, follow_symlinks=False)
            except FileNotFoundError:
                os.rename("lease", owner_name, src_dir_fd=audit_fd, dst_dir_fd=root_fd)
            fail("lease digest changed during recovery move")
        if quarantine_fd is not None:
            assert_named_identity(
                root_fd, quarantine_name, quarantine_stat, "quarantine metadata"
            )
            if read_bounded(quarantine_fd) != initial_quarantine:
                fail("quarantine metadata changed before recovery move")
            os.rename(
                quarantine_name,
                "QUARANTINED.json",
                src_dir_fd=root_fd,
                dst_dir_fd=audit_fd,
            )
            moved_quarantine = os.stat(
                "QUARANTINED.json", dir_fd=audit_fd, follow_symlinks=False
            )
            if (moved_quarantine.st_dev, moved_quarantine.st_ino) != (
                quarantine_stat.st_dev,
                quarantine_stat.st_ino,
            ):
                try:
                    os.stat(quarantine_name, dir_fd=root_fd, follow_symlinks=False)
                except FileNotFoundError:
                    os.rename(
                        "QUARANTINED.json",
                        quarantine_name,
                        src_dir_fd=audit_fd,
                        dst_dir_fd=root_fd,
                    )
                fail("quarantine identity changed during recovery move")

    audit_path = os.path.join(recovery_audit_root, audit_name)
    print(f"LEASE_RECOVERED audit={audit_path}")
finally:
    for fd in (audit_fd, audit_root_fd, quarantine_fd, owner_fd, root_fd):
        if fd is not None:
            try:
                os.close(fd)
            except OSError:
                pass
