import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, lstat, readFile, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import {
  createDriverDescriptor,
  driverContractVersion,
  validateCuaElementIndexAddress,
} from "./contract.mjs";
import { normalizeActionResult, normalizeVisibleState } from "./runtime-contract.mjs";

const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576;
const DEFAULT_MAX_IMAGE_BYTES = 25 * 1_048_576;
const INLINE_SCREENSHOT_JSON_OVERHEAD_BYTES = 1_048_576;
const DEFAULT_KILL_GRACE_MS = 1_000;
const DEFAULT_BUNDLE_MAX_FILES = 10_000;
const DEFAULT_BUNDLE_MAX_FILE_BYTES = 1_073_741_824;
const DEFAULT_BUNDLE_MAX_TOTAL_BYTES = 4_294_967_296;
const MACOS_SYSTEM_PYTHON = "/usr/bin/python3";
const PINNED_CURRENT_SPACE_FALLBACK_VERSION = "0.12.6";
const PINNED_METADATA_PATH = fileURLToPath(
  new URL("../fixtures/cua-driver/metadata.json", import.meta.url),
);
const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");
const PNG_MAX_DIMENSION = 16_384;
const PNG_MAX_DECODED_BYTES = 100 * 1_048_576;
const MACOS_PROCESS_INSTANCE_SCRIPT = String.raw`
import ctypes
import json
import sys

class ProcBsdInfo(ctypes.Structure):
    _fields_ = [
        ("pbi_flags", ctypes.c_uint32),
        ("pbi_status", ctypes.c_uint32),
        ("pbi_xstatus", ctypes.c_uint32),
        ("pbi_pid", ctypes.c_uint32),
        ("pbi_ppid", ctypes.c_uint32),
        ("pbi_uid", ctypes.c_uint32),
        ("pbi_gid", ctypes.c_uint32),
        ("pbi_ruid", ctypes.c_uint32),
        ("pbi_rgid", ctypes.c_uint32),
        ("pbi_svuid", ctypes.c_uint32),
        ("pbi_svgid", ctypes.c_uint32),
        ("rfu_1", ctypes.c_uint32),
        ("pbi_comm", ctypes.c_char * 16),
        ("pbi_name", ctypes.c_char * 32),
        ("pbi_nfiles", ctypes.c_uint32),
        ("pbi_pgid", ctypes.c_uint32),
        ("pbi_pjobc", ctypes.c_uint32),
        ("e_tdev", ctypes.c_uint32),
        ("e_tpgid", ctypes.c_uint32),
        ("pbi_nice", ctypes.c_int32),
        ("pbi_start_tvsec", ctypes.c_uint64),
        ("pbi_start_tvusec", ctypes.c_uint64),
    ]

libproc = ctypes.CDLL("/usr/lib/libproc.dylib", use_errno=True)

def process_instance(pid):
    info = ProcBsdInfo()
    size = ctypes.sizeof(info)
    if libproc.proc_pidinfo(pid, 3, 0, ctypes.byref(info), size) != size:
        return None
    path_buffer = ctypes.create_string_buffer(4096)
    path_length = libproc.proc_pidpath(pid, path_buffer, len(path_buffer))
    if path_length <= 0:
        return None
    return {
        "executable": path_buffer.value.decode("utf-8"),
        "pid": int(info.pbi_pid),
        "start_sec": int(info.pbi_start_tvsec),
        "start_usec": int(info.pbi_start_tvusec),
    }

mode = sys.argv[1]
if mode == "one":
    value = process_instance(int(sys.argv[2]))
    if value is None:
        sys.exit(3)
    print(json.dumps(value, separators=(",", ":")))
elif mode == "list":
    executable = sys.argv[2]
    needed = libproc.proc_listpids(1, 0, None, 0)
    pids = (ctypes.c_int * max(1, needed // ctypes.sizeof(ctypes.c_int)))()
    actual = libproc.proc_listpids(1, 0, pids, ctypes.sizeof(pids))
    values = []
    for pid in pids[:actual // ctypes.sizeof(ctypes.c_int)]:
        if pid <= 0:
            continue
        value = process_instance(pid)
        if value is not None and value["executable"] == executable:
            values.append(value)
    values.sort(key=lambda value: (value["pid"], value["start_sec"], value["start_usec"]))
    print(json.dumps(values, separators=(",", ":")))
else:
    sys.exit(64)
`;
const MACOS_RUNNING_APPLICATION_SCRIPT = String.raw`
ObjC.import("AppKit");

function readApplication(pid) {
  const application = $.NSRunningApplication.runningApplicationWithProcessIdentifier(pid);
  if (!application) {
    throw new Error("NSRunningApplication instance is unavailable");
  }
  const executableUrl = application.executableURL;
  const launchDate = application.launchDate;
  if (!executableUrl || !launchDate) {
    throw new Error("NSRunningApplication identity is incomplete");
  }
  const executable = ObjC.unwrap(executableUrl.path);
  const launchDateSeconds = Number(ObjC.unwrap(launchDate.timeIntervalSince1970));
  if (
    typeof executable !== "string" ||
    executable.length === 0 ||
    !Number.isFinite(launchDateSeconds) ||
    launchDateSeconds <= 0
  ) {
    throw new Error("NSRunningApplication identity is malformed");
  }
  return {
    application,
    executable,
    launch_date_micros: Math.round(launchDateSeconds * 1000000),
    pid,
  };
}

function run(argv) {
  const mode = argv[0];
  const pid = Number(argv[1]);
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error("invalid application pid");
  }
  const current = readApplication(pid);
  if (mode === "inspect") {
    return JSON.stringify({
      executable: current.executable,
      launch_date_micros: current.launch_date_micros,
      pid: current.pid,
    });
  }
  if (mode !== "terminate") {
    throw new Error("invalid application-instance operation");
  }
  const expectedExecutable = argv[2];
  const expectedLaunchDateMicros = Number(argv[3]);
  const force = argv[4] === "force";
  if (
    current.executable !== expectedExecutable ||
    current.launch_date_micros !== expectedLaunchDateMicros
  ) {
    throw new Error("application instance changed before termination");
  }
  const accepted = force ? current.application.forceTerminate : current.application.terminate;
  if (!accepted) {
    throw new Error("application termination request was rejected");
  }
  return JSON.stringify({
    executable: current.executable,
    launch_date_micros: current.launch_date_micros,
    pid: current.pid,
  });
}
`;
const MACOS_BUNDLE_HASH_SCRIPT = String.raw`
import hashlib
import json
import os
import stat
import sys

root = sys.argv[1]
max_files = int(sys.argv[2])
max_file_bytes = int(sys.argv[3])
max_total_bytes = int(sys.argv[4])
directory_flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
file_flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC

class BundleHashError(Exception):
    pass

def javascript_sort_key(value):
    return value.encode("utf-16-be", "surrogatepass")

def display_path(relative_path):
    return os.path.join(root, *relative_path.split("/"))

def same_directory(left, right):
    return (
        stat.S_ISDIR(right.st_mode)
        and left.st_dev == right.st_dev
        and left.st_ino == right.st_ino
    )

def same_file(left, right):
    return (
        stat.S_ISREG(right.st_mode)
        and left.st_dev == right.st_dev
        and left.st_ino == right.st_ino
        and left.st_size == right.st_size
        and left.st_mtime_ns == right.st_mtime_ns
    )

def open_directory(name, parent_fd, expected, relative_path):
    try:
        descriptor = os.open(name, directory_flags, dir_fd=parent_fd)
    except OSError as error:
        raise BundleHashError(
            f"CuaDriver bundle directory changed during traversal: {display_path(relative_path)}"
        ) from error
    opened = os.fstat(descriptor)
    if not same_directory(expected, opened):
        os.close(descriptor)
        raise BundleHashError(
            f"CuaDriver bundle directory changed during traversal: {display_path(relative_path)}"
        )
    return descriptor

def hash_bundle():
    try:
        root_fd = os.open(root, directory_flags)
    except OSError as error:
        raise BundleHashError(
            f"CuaDriver bundle root must be a non-symlink directory: {root}"
        ) from error
    try:
        root_stat = os.fstat(root_fd)
        if not stat.S_ISDIR(root_stat.st_mode):
            raise BundleHashError(
                f"CuaDriver bundle root must be a non-symlink directory: {root}"
            )

        directories = {"": root_stat}
        files = []
        state = {"entries": 0, "total_bytes": 0}

        def scan_directory(directory_fd, relative_directory):
            try:
                names = []
                with os.scandir(directory_fd) as entries:
                    for entry in entries:
                        state["entries"] += 1
                        if state["entries"] > max_files:
                            raise BundleHashError(
                                f"CuaDriver bundle file count exceeds {max_files}"
                            )
                        names.append(entry.name)
                names.sort(key=javascript_sort_key)
            except OSError as error:
                raise BundleHashError(
                    f"CuaDriver bundle directory changed during traversal: "
                    f"{display_path(relative_directory)}"
                ) from error
            for name in names:
                relative_path = (
                    f"{relative_directory}/{name}" if relative_directory else name
                )
                try:
                    observed = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
                except OSError as error:
                    raise BundleHashError(
                        f"CuaDriver bundle entry changed during traversal: "
                        f"{display_path(relative_path)}"
                    ) from error
                if stat.S_ISDIR(observed.st_mode):
                    child_fd = open_directory(
                        name,
                        directory_fd,
                        observed,
                        relative_path,
                    )
                    directories[relative_path] = os.fstat(child_fd)
                    try:
                        scan_directory(child_fd, relative_path)
                    finally:
                        os.close(child_fd)
                    continue
                if not stat.S_ISREG(observed.st_mode):
                    raise BundleHashError(
                        f"CuaDriver bundle digest rejects non-regular entry: "
                        f"{display_path(relative_path)}"
                    )
                try:
                    file_fd = os.open(name, file_flags, dir_fd=directory_fd)
                except OSError as error:
                    raise BundleHashError(
                        f"CuaDriver bundle file changed before hashing: "
                        f"{display_path(relative_path)}"
                    ) from error
                try:
                    opened = os.fstat(file_fd)
                    if not same_file(observed, opened):
                        raise BundleHashError(
                            f"CuaDriver bundle file changed before hashing: "
                            f"{display_path(relative_path)}"
                        )
                finally:
                    os.close(file_fd)
                if observed.st_size > max_file_bytes:
                    raise BundleHashError(
                        f"CuaDriver bundle file bytes exceed {max_file_bytes}: "
                        f"{display_path(relative_path)}"
                    )
                state["total_bytes"] += observed.st_size
                if state["total_bytes"] > max_total_bytes:
                    raise BundleHashError(
                        f"CuaDriver bundle total bytes exceed {max_total_bytes}"
                    )
                files.append((relative_path, observed))

        scan_directory(root_fd, "")
        if not files:
            raise BundleHashError(f"bundle has no regular files: {root}")
        files.sort(key=lambda item: javascript_sort_key(item[0]))

        digest = hashlib.sha256()
        for relative_path, expected_file in files:
            components = relative_path.split("/")
            parent_fd = os.dup(root_fd)
            current_relative = ""
            try:
                for component in components[:-1]:
                    current_relative = (
                        f"{current_relative}/{component}" if current_relative else component
                    )
                    expected_directory = directories[current_relative]
                    next_fd = open_directory(
                        component,
                        parent_fd,
                        expected_directory,
                        current_relative,
                    )
                    os.close(parent_fd)
                    parent_fd = next_fd
                try:
                    file_fd = os.open(components[-1], file_flags, dir_fd=parent_fd)
                except OSError as error:
                    raise BundleHashError(
                        f"CuaDriver bundle file changed before hashing: "
                        f"{display_path(relative_path)}"
                    ) from error
                try:
                    opened_file = os.fstat(file_fd)
                    if not same_file(expected_file, opened_file):
                        raise BundleHashError(
                            f"CuaDriver bundle file changed before hashing: "
                            f"{display_path(relative_path)}"
                        )
                    digest.update(relative_path.encode("utf-8"))
                    digest.update(b"\0")
                    digest.update(str(expected_file.st_size).encode("ascii"))
                    digest.update(b"\0")
                    streamed_bytes = 0
                    while True:
                        chunk = os.read(file_fd, 1024 * 1024)
                        if not chunk:
                            break
                        streamed_bytes += len(chunk)
                        if (
                            streamed_bytes > expected_file.st_size
                            or streamed_bytes > max_file_bytes
                        ):
                            raise BundleHashError(
                                f"CuaDriver bundle file changed or exceeded bounds: "
                                f"{display_path(relative_path)}"
                            )
                        digest.update(chunk)
                    final_file = os.fstat(file_fd)
                    if (
                        streamed_bytes != expected_file.st_size
                        or not same_file(opened_file, final_file)
                    ):
                        raise BundleHashError(
                            f"CuaDriver bundle file changed while hashing: "
                            f"{display_path(relative_path)}"
                        )
                    digest.update(b"\0")
                finally:
                    os.close(file_fd)
            finally:
                os.close(parent_fd)
        return digest.hexdigest()
    finally:
        os.close(root_fd)

try:
    value = {"digest": hash_bundle(), "ok": True}
except (BundleHashError, OSError, UnicodeError, ValueError) as error:
    value = {"error": str(error), "ok": False}
print(json.dumps(value, separators=(",", ":")))
`;
const PNG_CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
}

export const pinnedCuaDriverMetadata = deepFreeze(
  JSON.parse(await readFile(PINNED_METADATA_PATH, "utf8")),
);

export const cuaDriverDescriptor = createDriverDescriptor(
  {
    id: "cua-driver",
    displayName: "CuaDriver",
    contractVersion: driverContractVersion,
    status: "fixture-contract-qualified",
    addressKinds: ["cua-element-index", "text-pattern"],
    capabilities: {
      connect: true,
      visibleState: true,
      findElement: true,
      click: true,
      setValue: true,
      screenshotFromState: true,
      textFromState: true,
      close: true,
      metadata: true,
      wait: false,
    },
  },
  {
    additionalAddressValidators: {
      "cua-element-index": validateCuaElementIndexAddress,
    },
  },
);

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  if (value.includes("\0")) throw new TypeError(`${label} must not contain NUL`);
  return value;
}

function requireArgv(args) {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string" || arg.includes("\0"))) {
    throw new TypeError("process argv must be an array of NUL-free strings");
  }
  return args;
}

export class CuaProcessError extends Error {
  constructor(
    message,
    { command, args, code = null, signal = null, stdout = "", stderr = "" } = {},
  ) {
    super(message);
    this.name = "CuaProcessError";
    this.command = command;
    this.args = args;
    this.code = code;
    this.signal = signal;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

export function createCuaProcessRunner({
  spawnImpl = spawn,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
  killGraceMs = DEFAULT_KILL_GRACE_MS,
  signalProcessGroup = (pid, signal) => process.kill(-pid, signal),
  scheduleTimeout = setTimeout,
  cancelTimeout = clearTimeout,
} = {}) {
  return Object.freeze({
    run(command, args, options = {}) {
      const executable = requireNonEmptyString(command, "process command");
      const argv = requireArgv(args);
      const effectiveTimeoutMs = options.timeoutMs ?? timeoutMs;
      const effectiveMaxOutputBytes = options.maxOutputBytes ?? maxOutputBytes;
      if (!Number.isInteger(effectiveTimeoutMs) || effectiveTimeoutMs <= 0) {
        throw new TypeError("process timeoutMs must be a positive integer");
      }
      if (!Number.isInteger(effectiveMaxOutputBytes) || effectiveMaxOutputBytes <= 0) {
        throw new TypeError("process maxOutputBytes must be a positive integer");
      }
      if (!Number.isInteger(killGraceMs) || killGraceMs <= 0) {
        throw new TypeError("process killGraceMs must be a positive integer");
      }

      return new Promise((resolve, reject) => {
        let child;
        try {
          child = spawnImpl(executable, argv, {
            detached: true,
            shell: false,
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
          });
        } catch (error) {
          reject(error);
          return;
        }

        let stdout = "";
        let stderr = "";
        let stdoutBytes = 0;
        let stderrBytes = 0;
        let terminalError = null;
        let forceKillTimer = null;
        let timeout = null;
        let settled = false;
        let closeCode = null;
        let closeSignal = null;

        const clearTimers = () => {
          if (timeout) cancelTimeout(timeout);
          if (forceKillTimer) cancelTimeout(forceKillTimer);
        };
        const destroyPipes = () => {
          child.stdout?.destroy?.();
          child.stderr?.destroy?.();
        };
        const settle = (callback, value) => {
          if (settled) return;
          settled = true;
          clearTimers();
          callback(value);
        };
        const signalGroup = (signal) => {
          if (!Number.isInteger(child.pid) || child.pid <= 0) {
            throw new Error("CuaDriver child has no valid POSIX process-group leader pid");
          }
          signalProcessGroup(child.pid, signal);
        };
        const terminate = (error) => {
          if (terminalError || settled) return;
          terminalError = error;
          destroyPipes();
          try {
            signalGroup("SIGTERM");
          } catch {}
          forceKillTimer = scheduleTimeout(() => {
            try {
              signalGroup("SIGKILL");
            } catch {}
            destroyPipes();
            terminalError.code = closeCode;
            terminalError.signal = closeSignal ?? "SIGKILL";
            terminalError.stdout = stdout;
            terminalError.stderr = stderr;
            settle(reject, terminalError);
          }, killGraceMs);
        };

        const append = (streamName, chunk) => {
          if (settled) return;
          const text = String(chunk);
          const bytes = Buffer.byteLength(text);
          if (streamName === "stdout") {
            stdoutBytes += bytes;
            if (stdoutBytes <= effectiveMaxOutputBytes) stdout += text;
          } else {
            stderrBytes += bytes;
            if (stderrBytes <= effectiveMaxOutputBytes) stderr += text;
          }
          if (
            !terminalError &&
            (stdoutBytes > effectiveMaxOutputBytes || stderrBytes > effectiveMaxOutputBytes)
          ) {
            terminate(
              new CuaProcessError(
                `CuaDriver ${streamName} exceeds ${effectiveMaxOutputBytes} bytes`,
                { command: executable, args: argv, stdout, stderr },
              ),
            );
          }
        };

        child.stdout?.setEncoding?.("utf8");
        child.stderr?.setEncoding?.("utf8");
        child.stdout?.on?.("data", (chunk) => append("stdout", chunk));
        child.stderr?.on?.("data", (chunk) => append("stderr", chunk));

        timeout = scheduleTimeout(() => {
          if (terminalError) return;
          terminate(
            new CuaProcessError(`CuaDriver process timed out after ${effectiveTimeoutMs}ms`, {
              command: executable,
              args: argv,
              stdout,
              stderr,
            }),
          );
        }, effectiveTimeoutMs);
        timeout.unref?.();

        child.once("error", (error) => {
          if (terminalError) return;
          settle(reject, error);
        });
        child.once("close", (code, signal) => {
          closeCode = code;
          closeSignal = signal;
          if (terminalError) {
            return;
          }
          if (code !== 0) {
            settle(
              reject,
              new CuaProcessError(`CuaDriver process exited with ${code ?? `signal ${signal}`}`, {
                command: executable,
                args: argv,
                code,
                signal,
                stdout,
                stderr,
              }),
            );
            return;
          }
          settle(resolve, { stdout, stderr });
        });
      });
    },
  });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pngCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = PNG_CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function invalidPng(reason) {
  throw new Error(`CuaDriver screenshot is not a valid PNG: ${reason}`);
}

export function validatePngScreenshot(bytes) {
  const png = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (png.length < PNG_SIGNATURE.length || !png.subarray(0, 8).equals(PNG_SIGNATURE)) {
    invalidPng("signature mismatch");
  }
  let offset = 8;
  let ihdr = null;
  let sawIend = false;
  let sawIdat = false;
  let idatEnded = false;
  const idatChunks = [];
  while (offset < png.length) {
    if (png.length - offset < 12) invalidPng("truncated chunk");
    const length = png.readUInt32BE(offset);
    const chunkEnd = offset + 12 + length;
    if (!Number.isSafeInteger(chunkEnd) || chunkEnd > png.length) {
      invalidPng("chunk length exceeds file bounds");
    }
    const typeBytes = png.subarray(offset + 4, offset + 8);
    const type = typeBytes.toString("ascii");
    if (!/^[A-Za-z]{4}$/.test(type)) invalidPng("invalid chunk type");
    const data = png.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = png.readUInt32BE(offset + 8 + length);
    const actualCrc = pngCrc32(png.subarray(offset + 4, offset + 8 + length));
    if (actualCrc !== expectedCrc) invalidPng(`${type} CRC mismatch`);
    if (sawIend) invalidPng("trailing chunk after IEND");
    if (type === "IHDR") {
      if (offset !== 8 || ihdr !== null || length !== 13) invalidPng("invalid IHDR");
      const width = data.readUInt32BE(0);
      const height = data.readUInt32BE(4);
      const bitDepth = data[8];
      const colorType = data[9];
      const compression = data[10];
      const filter = data[11];
      const interlace = data[12];
      if (width === 0 || height === 0 || width > PNG_MAX_DIMENSION || height > PNG_MAX_DIMENSION) {
        invalidPng("unsafe IHDR dimensions");
      }
      if (bitDepth !== 8 || ![2, 6].includes(colorType)) {
        invalidPng("screenshot must use qualified 8-bit RGB or RGBA encoding");
      }
      if (compression !== 0 || filter !== 0 || interlace !== 0) {
        invalidPng("unsupported IHDR encoding");
      }
      ihdr = { bitDepth, colorType, height, width };
    } else if (type === "IDAT") {
      if (!ihdr || idatEnded) invalidPng("invalid IDAT ordering");
      sawIdat = true;
      idatChunks.push(data);
    } else {
      if (sawIdat) idatEnded = true;
      if (type === "IEND") {
        if (length !== 0 || !ihdr || !sawIdat) invalidPng("invalid IEND");
        sawIend = true;
      } else if (type === "PLTE") {
        invalidPng("PLTE is not allowed by the qualified RGB/RGBA screenshot contract");
      } else if (["tEXt", "zTXt", "iTXt", "iCCP"].includes(type)) {
        invalidPng(`${type} is not allowed in pixel-only screenshot evidence`);
      } else if (type[0] === type[0].toUpperCase()) {
        invalidPng(`unknown critical PNG chunk ${type}`);
      }
    }
    offset = chunkEnd;
  }
  if (!sawIend || offset !== png.length) invalidPng("missing complete IEND");
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ihdr.colorType];
  const rowBytes = Math.ceil((ihdr.width * ihdr.bitDepth * channels) / 8);
  const expectedInflatedBytes = ihdr.height * (rowBytes + 1);
  if (
    !Number.isSafeInteger(expectedInflatedBytes) ||
    expectedInflatedBytes > PNG_MAX_DECODED_BYTES
  ) {
    invalidPng(`decoded PNG size exceeds ${PNG_MAX_DECODED_BYTES} bytes`);
  }
  const concatenatedIdat = Buffer.concat(idatChunks);
  let inflateResult;
  try {
    inflateResult = inflateSync(concatenatedIdat, {
      info: true,
      maxOutputLength: expectedInflatedBytes + 1,
    });
  } catch (error) {
    invalidPng(`IDAT inflate failed: ${error.message}`);
  }
  if (inflateResult.engine.bytesWritten !== concatenatedIdat.length) {
    invalidPng("trailing bytes after zlib stream");
  }
  const inflated = inflateResult.buffer;
  if (inflated.length !== expectedInflatedBytes) {
    invalidPng("IDAT scanline length mismatch");
  }
  for (let row = 0; row < ihdr.height; row += 1) {
    if (inflated[row * (rowBytes + 1)] > 4) invalidPng("invalid scanline filter");
  }
  return Object.freeze({ height: ihdr.height, width: ihdr.width });
}

function hasExactKeys(value, required, optional = []) {
  const actual = Object.keys(value).sort();
  const requiredKeys = [...required].sort();
  if (requiredKeys.some((key) => !Object.hasOwn(value, key))) return false;
  const allowed = new Set([...required, ...optional]);
  return actual.every((key) => allowed.has(key));
}

function validateEnvelope(value) {
  for (const key of Object.keys(value)) {
    if (!["content", "structuredContent", "isError"].includes(key)) {
      throw new Error(`malformed CuaDriver output: unknown MCP envelope key ${key}`);
    }
  }
  if (!Array.isArray(value.content)) {
    throw new Error("malformed CuaDriver output: MCP content must be an array");
  }
  if (typeof value.isError !== "boolean") {
    throw new Error("malformed CuaDriver output: MCP isError must be a boolean");
  }
  if (!isPlainObject(value.structuredContent)) {
    throw new Error("malformed CuaDriver output: MCP structuredContent must be an object");
  }
  for (const [index, item] of value.content.entries()) {
    const validText =
      isPlainObject(item) &&
      item.type === "text" &&
      hasExactKeys(item, ["type", "text"]) &&
      typeof item.text === "string";
    const validImage =
      isPlainObject(item) &&
      item.type === "image" &&
      hasExactKeys(item, ["type", "data"], ["mimeType"]) &&
      typeof item.data === "string" &&
      (item.mimeType === undefined || typeof item.mimeType === "string");
    if (!validText && !validImage) {
      throw new Error(`malformed CuaDriver output: invalid MCP content[${index}]`);
    }
  }
}

export function parseCuaCliOutput(output, { maxBytes = DEFAULT_MAX_OUTPUT_BYTES } = {}) {
  if (typeof output !== "string") {
    throw new TypeError("CuaDriver output must be a string");
  }
  const bytes = Buffer.byteLength(output);
  if (bytes > maxBytes) throw new Error(`CuaDriver output exceeds ${maxBytes} bytes`);
  const trimmed = output.trim();
  if (trimmed === "") {
    throw new Error("malformed CuaDriver output: empty stdout");
  }

  let decoded;
  try {
    decoded = JSON.parse(trimmed);
  } catch (error) {
    if (/^[{[]/.test(trimmed)) {
      throw new Error(`malformed CuaDriver output: ${error.message}`);
    }
    return Object.freeze({
      structured: null,
      text: trimmed,
      imageBase64: "",
      isError: false,
      envelope: false,
    });
  }

  if (!isPlainObject(decoded)) {
    throw new Error("malformed CuaDriver output: expected a JSON object");
  }
  const envelope = Object.hasOwn(decoded, "content") || Object.hasOwn(decoded, "structuredContent");
  if (!envelope) {
    return Object.freeze({
      structured: decoded,
      text: "",
      imageBase64: "",
      isError: false,
      envelope: false,
    });
  }

  validateEnvelope(decoded);
  const text = decoded.content.find((item) => item.type === "text")?.text ?? "";
  const imageBase64 = decoded.content.find((item) => item.type === "image")?.data ?? "";
  return Object.freeze({
    structured: decoded.structuredContent,
    text,
    imageBase64,
    isError: decoded.isError,
    envelope: true,
  });
}

function validateClickSuccess(structured, { historicalEnvelope = false } = {}) {
  return (
    isPlainObject(structured) &&
    hasExactKeys(
      structured,
      historicalEnvelope ? ["effect", "ok", "path", "verified"] : ["effect", "path", "verified"],
    ) &&
    (!historicalEnvelope || structured.ok === true) &&
    structured.effect === "unverifiable" &&
    ["ax", "ax_fg", "cgevent", "cgevent_fg", "cgevent_hid"].includes(structured.path) &&
    structured.verified === false
  );
}

function setValueSuccessGrammar(elementIndex) {
  const suffix =
    "(?:\\n\\n(?:🪟 Action opened new window\\(s\\): [^\\r\\n]+\\.|🔀 Action caused a different app to become frontmost\\.))?";
  const families = [
    `✅ Set AXValue on \\[${elementIndex}\\] AX[A-Za-z0-9]+\\.`,
    `✅ Set AXValue on \\[${elementIndex}\\] AX[A-Za-z0-9]+ via AXIncrement/AXDecrement stepping\\.`,
    `✅ Selected '[^'\\r\\n]*' in AXPopUpButton \\[${elementIndex}\\] "[^"\\r\\n]*" via AX child AXPress\\.`,
    `✅ Set select \\[${elementIndex}\\] '[^'\\r\\n]*' to '[^'\\r\\n]*' via Safari JavaScript \\(DOM value: "[^"\\r\\n]*"\\)\\.`,
  ];
  return new RegExp(`^(?:${families.join("|")})${suffix}$`);
}

export function normalizeCuaActionOutput(
  parsed,
  { tool, input, version = pinnedCuaDriverMetadata.cli.version } = {},
) {
  if (!parsed || typeof parsed !== "object") {
    throw new TypeError("parsed CuaDriver action output is required");
  }
  if (!["click", "set_value"].includes(tool)) {
    throw new TypeError("CuaDriver action tool must be click or set_value");
  }
  if (!Number.isInteger(input?.element_index) || input.element_index < 0) {
    throw new TypeError(`CuaDriver ${tool} requires an integer element_index`);
  }
  if (parsed.isError === true) {
    throw new Error(`CuaDriver ${tool} historical envelope returned isError:true`);
  }
  if (tool === "click") {
    if (parsed.structured?.effect === "suspected_noop") {
      throw new Error("CuaDriver click reported suspected_noop semantic soft failure");
    }
    if (!validateClickSuccess(parsed.structured, { historicalEnvelope: parsed.envelope })) {
      throw new Error("CuaDriver click lacks pinned structured success evidence");
    }
    return normalizeActionResult({ ok: true, text: parsed.text, isError: false });
  }
  if (
    version !== PINNED_CURRENT_SPACE_FALLBACK_VERSION ||
    parsed.envelope ||
    parsed.structured !== null ||
    !setValueSuccessGrammar(input.element_index).test(parsed.text)
  ) {
    throw new Error("CuaDriver set_value lacks pinned plaintext success evidence");
  }
  return normalizeActionResult({ ok: true, text: parsed.text, isError: false });
}

function requireBundleBound(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}

export function createCuaBundleTreeHasher({
  preflightPython = (executable) => access(executable, fsConstants.X_OK),
  createProcessRunner = createCuaProcessRunner,
} = {}) {
  if (typeof preflightPython !== "function") {
    throw new TypeError("bundle digest preflightPython must be a function");
  }
  if (typeof createProcessRunner !== "function") {
    throw new TypeError("bundle digest createProcessRunner must be a function");
  }
  const runner = createProcessRunner({
    timeoutMs: 120_000,
    maxOutputBytes: 65_536,
  });
  return async function hashBundleTree(appPath, options = {}) {
    const root = requireNonEmptyString(appPath, "bundle path");
    if (!isPlainObject(options)) throw new TypeError("bundle digest options must be an object");
    const unknownOptions = Object.keys(options).filter(
      (key) => !["maxFiles", "maxFileBytes", "maxTotalBytes"].includes(key),
    );
    if (unknownOptions.length > 0) {
      throw new TypeError(`unknown bundle digest option(s): ${unknownOptions.join(", ")}`);
    }
    const bounds = Object.freeze({
      maxFiles: requireBundleBound(options.maxFiles ?? DEFAULT_BUNDLE_MAX_FILES, "bundle maxFiles"),
      maxFileBytes: requireBundleBound(
        options.maxFileBytes ?? DEFAULT_BUNDLE_MAX_FILE_BYTES,
        "bundle maxFileBytes",
      ),
      maxTotalBytes: requireBundleBound(
        options.maxTotalBytes ?? DEFAULT_BUNDLE_MAX_TOTAL_BYTES,
        "bundle maxTotalBytes",
      ),
    });
    try {
      await preflightPython(MACOS_SYSTEM_PYTHON);
    } catch (error) {
      throw new Error(
        `CuaDriver bundle hashing requires executable macOS system Python at ${MACOS_SYSTEM_PYTHON}`,
        { cause: error },
      );
    }
    const result = await runner.run(MACOS_SYSTEM_PYTHON, [
      "-c",
      MACOS_BUNDLE_HASH_SCRIPT,
      root,
      String(bounds.maxFiles),
      String(bounds.maxFileBytes),
      String(bounds.maxTotalBytes),
    ]);
    let decoded;
    try {
      decoded = JSON.parse(result.stdout);
    } catch {
      throw new Error("CuaDriver bundle digest helper returned malformed JSON");
    }
    if (
      !isPlainObject(decoded) ||
      !hasExactKeys(decoded, decoded.ok === true ? ["digest", "ok"] : ["error", "ok"])
    ) {
      throw new Error("CuaDriver bundle digest helper returned malformed JSON");
    }
    if (decoded.ok !== true) {
      throw new Error(
        typeof decoded.error === "string" && decoded.error !== ""
          ? decoded.error
          : "CuaDriver bundle digest helper failed without an error",
      );
    }
    if (typeof decoded.digest !== "string" || !/^[0-9a-f]{64}$/.test(decoded.digest)) {
      throw new Error("CuaDriver bundle digest helper returned malformed JSON");
    }
    return decoded.digest;
  };
}

const defaultBundleTreeHasher = createCuaBundleTreeHasher();

export async function hashCuaBundleTree(appPath, options = {}) {
  return defaultBundleTreeHasher(appPath, options);
}

export function parseCuaCodesignIdentity(output) {
  if (typeof output !== "string" || output.trim() === "") {
    throw new Error("CuaDriver.app codesign output is empty");
  }
  const digest = output.match(/^CandidateCDHashFull sha256=([0-9a-f]{64})$/m)?.[1];
  const authority = output.match(/^Authority=Developer ID Application: (.+)$/m)?.[1];
  const teamIdentifier = output.match(/^TeamIdentifier=([A-Z0-9]+)$/m)?.[1];
  if (!digest || !authority || !teamIdentifier) {
    throw new Error("CuaDriver.app codesign output is missing its full signing identity");
  }
  return Object.freeze({
    codeSigningDigestSha256: digest,
    developerId: authority,
    teamIdentifier,
  });
}

function compareWindows(left, right) {
  const zDifference = Number(right.z_index) - Number(left.z_index);
  if (zDifference !== 0) return zDifference;
  return Number(left.window_id) - Number(right.window_id);
}

export function selectCuaWindow(
  windows,
  pid,
  { version = pinnedCuaDriverMetadata.cli.version } = {},
) {
  if (!Array.isArray(windows)) throw new TypeError("CuaDriver windows must be an array");
  if (!Number.isInteger(pid) || pid <= 0)
    throw new TypeError("target pid must be a positive integer");
  const eligible = windows.filter(
    (window) =>
      isPlainObject(window) &&
      window.pid === pid &&
      window.layer === 0 &&
      window.is_on_screen === true &&
      window.on_current_space !== false &&
      Number.isInteger(window.window_id) &&
      window.window_id > 0 &&
      Number.isFinite(window.z_index),
  );
  const explicit = eligible
    .filter((window) => window.on_current_space === true)
    .sort(compareWindows);
  if (explicit.length > 0) {
    return Object.freeze({
      window: Object.freeze({ ...explicit[0] }),
      currentSpaceEvidence: "explicit",
    });
  }
  const fallback =
    version === PINNED_CURRENT_SPACE_FALLBACK_VERSION
      ? eligible.filter((window) => window.on_current_space === null).sort(compareWindows)
      : [];
  if (fallback.length > 0) {
    return Object.freeze({
      window: Object.freeze({ ...fallback[0] }),
      currentSpaceEvidence: "is_on_screen_fallback",
    });
  }
  throw new Error(
    `CuaDriver found no eligible on-screen current-Space layer-0 window for pid ${pid}`,
  );
}

async function defaultCanonicalPath(inputPath) {
  return realpath(inputPath);
}

async function defaultResolveBundleExecutablePath(appPath, processRunner) {
  const executableResult = await processRunner.run("/usr/bin/plutil", [
    "-extract",
    "CFBundleExecutable",
    "raw",
    "-o",
    "-",
    path.join(appPath, "Contents", "Info.plist"),
  ]);
  const executableName = requireNonEmptyString(
    executableResult.stdout.trim(),
    "target CFBundleExecutable",
  );
  const executablePath = await realpath(path.join(appPath, "Contents", "MacOS", executableName));
  const stats = await lstat(executablePath);
  if (!stats.isFile() || (stats.mode & 0o111) === 0) {
    throw new Error(`target bundle executable is not a regular executable: ${executablePath}`);
  }
  return executablePath;
}

async function defaultResolveExecutablePath(inputPath, processRunner) {
  const requested = requireNonEmptyString(inputPath, "CuaDriver CLI path");
  if (requested.includes(path.sep)) return realpath(requested);
  const result = await processRunner.run("/usr/bin/which", [requested]);
  return realpath(requireNonEmptyString(result.stdout.trim(), "resolved CuaDriver CLI path"));
}

async function defaultReadExecutableIdentity(executablePath, processRunner) {
  const stats = await lstat(executablePath);
  if (!stats.isFile() || (stats.mode & 0o111) === 0) {
    throw new Error(`CuaDriver CLI is not a regular executable: ${executablePath}`);
  }
  const bytes = await readFile(executablePath);
  const digestSha256 = createHash("sha256").update(bytes).digest("hex");
  await processRunner.run("/usr/bin/codesign", [
    "--verify",
    "--strict",
    "--verbose=2",
    executablePath,
  ]);
  const codesignResult = await processRunner.run("/usr/bin/codesign", [
    "-d",
    "--verbose=4",
    executablePath,
  ]);
  return {
    digestSha256,
    ...parseCuaCodesignIdentity(`${codesignResult.stdout}\n${codesignResult.stderr}`),
  };
}

async function defaultReadBundleIdentity(
  appPath,
  processRunner,
  { requireDeveloperSigningIdentity = false } = {},
) {
  const stats = await lstat(appPath);
  if (!stats.isDirectory()) throw new Error(`app bundle is not a directory: ${appPath}`);
  const infoPlist = path.join(appPath, "Contents", "Info.plist");
  const readPlistField = async (field) => {
    const result = await processRunner.run("/usr/bin/plutil", [
      "-extract",
      field,
      "raw",
      "-o",
      "-",
      infoPlist,
    ]);
    return result.stdout.trim();
  };
  const [bundleId, shortVersion, buildVersion, digestSha256] = await Promise.all([
    readPlistField("CFBundleIdentifier"),
    readPlistField("CFBundleShortVersionString"),
    readPlistField("CFBundleVersion"),
    hashCuaBundleTree(appPath),
  ]);
  const identity = {
    bundleId,
    shortVersion,
    buildVersion,
    digestSha256,
  };
  if (!requireDeveloperSigningIdentity) return identity;
  await processRunner.run("/usr/bin/codesign", [
    "--verify",
    "--deep",
    "--strict",
    "--verbose=2",
    appPath,
  ]);
  const codesignResult = await processRunner.run("/usr/bin/codesign", [
    "-d",
    "--verbose=4",
    appPath,
  ]);
  return {
    ...identity,
    ...parseCuaCodesignIdentity(`${codesignResult.stdout}\n${codesignResult.stderr}`),
  };
}

function parseProcessInstance(value, expectedPid = 0) {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, ["executable", "pid", "start_sec", "start_usec"]) ||
    typeof value.executable !== "string" ||
    value.executable === "" ||
    !Number.isInteger(value.pid) ||
    value.pid <= 0 ||
    !Number.isSafeInteger(value.start_sec) ||
    value.start_sec <= 0 ||
    !Number.isInteger(value.start_usec) ||
    value.start_usec < 0 ||
    value.start_usec >= 1_000_000 ||
    (expectedPid > 0 && value.pid !== expectedPid)
  ) {
    throw new Error("CuaDriver macOS process-instance helper returned malformed JSON");
  }
  return Object.freeze({
    birthMarker: `${value.start_sec}.${String(value.start_usec).padStart(6, "0")}`,
    executable: value.executable,
    pid: value.pid,
    startSec: value.start_sec,
    startUsec: value.start_usec,
  });
}

async function defaultQueryProcessInstance(pid, processRunner) {
  let result;
  try {
    result = await processRunner.run("/usr/bin/python3", [
      "-c",
      MACOS_PROCESS_INSTANCE_SCRIPT,
      "one",
      String(pid),
    ]);
  } catch (error) {
    if (error instanceof CuaProcessError && error.code === 3) {
      const gone = new Error(`pid ${pid} no longer exists`);
      gone.code = "ESRCH";
      throw gone;
    }
    throw error;
  }
  let decoded;
  try {
    decoded = JSON.parse(result.stdout);
  } catch {
    throw new Error("CuaDriver macOS process-instance helper returned malformed JSON");
  }
  const instance = parseProcessInstance(decoded, pid);
  return Object.freeze({
    ...instance,
    executable: await realpath(instance.executable),
  });
}

async function defaultListProcessInstances(executablePath, processRunner) {
  const result = await processRunner.run("/usr/bin/python3", [
    "-c",
    MACOS_PROCESS_INSTANCE_SCRIPT,
    "list",
    executablePath,
  ]);
  let decoded;
  try {
    decoded = JSON.parse(result.stdout);
  } catch {
    throw new Error("CuaDriver macOS process-instance helper returned malformed JSON");
  }
  if (!Array.isArray(decoded)) {
    throw new Error("CuaDriver macOS process-instance helper returned malformed JSON");
  }
  return Promise.all(
    decoded.map(async (value) => {
      const instance = parseProcessInstance(value);
      return Object.freeze({
        ...instance,
        executable: await realpath(instance.executable),
      });
    }),
  );
}

function parseRunningApplicationInstance(value, expectedPid) {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, ["executable", "launch_date_micros", "pid"]) ||
    typeof value.executable !== "string" ||
    value.executable === "" ||
    !Number.isSafeInteger(value.launch_date_micros) ||
    value.launch_date_micros <= 0 ||
    value.pid !== expectedPid
  ) {
    throw new Error("CuaDriver NSRunningApplication helper returned malformed JSON");
  }
  return Object.freeze({
    executable: value.executable,
    launchDateMicros: value.launch_date_micros,
    pid: value.pid,
  });
}

async function defaultInspectApplicationInstance(instance, processRunner) {
  const result = await processRunner.run("/usr/bin/osascript", [
    "-l",
    "JavaScript",
    "-e",
    MACOS_RUNNING_APPLICATION_SCRIPT,
    "--",
    "inspect",
    String(instance.pid),
  ]);
  let decoded;
  try {
    decoded = JSON.parse(result.stdout);
  } catch {
    throw new Error("CuaDriver NSRunningApplication helper returned malformed JSON");
  }
  return parseRunningApplicationInstance(decoded, instance.pid);
}

async function defaultTerminateApplicationInstance(instance, { force }, processRunner) {
  const result = await processRunner.run("/usr/bin/osascript", [
    "-l",
    "JavaScript",
    "-e",
    MACOS_RUNNING_APPLICATION_SCRIPT,
    "--",
    "terminate",
    String(instance.pid),
    instance.applicationExecutable,
    String(instance.applicationLaunchDateMicros),
    force ? "force" : "graceful",
  ]);
  let decoded;
  try {
    decoded = JSON.parse(result.stdout);
  } catch {
    throw new Error("CuaDriver NSRunningApplication helper returned malformed JSON");
  }
  const terminated = parseRunningApplicationInstance(decoded, instance.pid);
  if (
    terminated.executable !== instance.applicationExecutable ||
    terminated.launchDateMicros !== instance.applicationLaunchDateMicros
  ) {
    throw new Error("CuaDriver application instance changed before termination");
  }
}

function assertIdentity(actual, expected, label) {
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (actual?.[field] !== expectedValue) {
      throw new Error(
        `${label} ${field} mismatch: expected ${expectedValue}, got ${actual?.[field] ?? "<missing>"}`,
      );
    }
  }
}

function requireAbsoluteCanonicalInput(appPath, canonicalPath) {
  if (!path.isAbsolute(appPath) || path.normalize(appPath) !== appPath) {
    throw new Error("target appPath must be an absolute normalized path");
  }
  if (canonicalPath !== appPath) {
    throw new Error(`target appPath must be canonical: expected ${canonicalPath}`);
  }
  if (!appPath.endsWith(".app")) throw new Error("target appPath must name an .app bundle");
}

function pathIsWithin(filePath, directory) {
  const relative = path.relative(directory, filePath);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function sameProcessInstance(left, right) {
  return (
    left?.pid === right?.pid &&
    left?.birthMarker === right?.birthMarker &&
    left?.executable === right?.executable
  );
}

function processInstanceKey(instance) {
  return `${instance.pid}:${instance.birthMarker}:${instance.executable}`;
}

export function parseCuaSocketOwner(output, canonicalSocketPath) {
  if (typeof output !== "string") throw new TypeError("lsof output must be a string");
  const socketPath = requireNonEmptyString(canonicalSocketPath, "canonical CuaDriver socket path");
  const processes = [];
  let processRecord = null;
  let fileRecord = null;
  for (const line of output.split(/\r?\n/)) {
    if (line === "") continue;
    const field = line[0];
    const value = line.slice(1);
    if (field === "p") {
      const pid = Number(value);
      processRecord = {
        command: "",
        files: [],
        pid: Number.isInteger(pid) && pid > 0 ? pid : 0,
      };
      processes.push(processRecord);
      fileRecord = null;
    } else if (field === "c" && processRecord) {
      processRecord.command = value;
    } else if (field === "f" && processRecord) {
      fileRecord = { descriptor: value, name: "" };
      processRecord.files.push(fileRecord);
    } else if (field === "n" && fileRecord) {
      fileRecord.name = value;
    }
  }
  const owners = processes.filter(
    (record) =>
      record.pid > 0 &&
      record.command === "cua-driver" &&
      record.files.some((file) => file.descriptor !== "" && file.name === socketPath),
  );
  const uniquePids = [...new Set(owners.map((owner) => owner.pid))];
  if (uniquePids.length !== 1) {
    throw new Error(
      `CuaDriver socket ownership requires exactly one CuaDriver listener PID for ${socketPath}`,
    );
  }
  return Object.freeze({
    command: "cua-driver",
    pid: uniquePids[0],
    socketPath,
  });
}

function normalizeRole(role) {
  const roleMap = {
    AXApplication: "application",
    AXButton: "button",
    AXCheckBox: "checkbox",
    AXComboBox: "combo box",
    AXHeading: "heading",
    AXLink: "link",
    AXList: "list",
    AXPopUpButton: "popup button",
    AXRadioButton: "radio button",
    AXStaticText: "text",
    AXTextArea: "text area",
    AXTextField: "text field",
    AXWebArea: "web area",
    AXWindow: "window",
  };
  if (roleMap[role]) return roleMap[role];
  const withoutPrefix = String(role || "element").replace(/^AX/, "");
  return withoutPrefix.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

function normalizeElementsText(elements, treeMarkdown) {
  if (!Array.isArray(elements)) {
    throw new Error("CuaDriver window state elements must be an array");
  }
  const lines = elements.map((element, index) => {
    if (!isPlainObject(element) || !Number.isInteger(element.element_index)) {
      throw new Error(`CuaDriver window state has invalid element at index ${index}`);
    }
    const label =
      typeof element.label === "string" && element.label.trim() !== ""
        ? element.label.trim()
        : typeof element.value === "string"
          ? element.value.trim()
          : "";
    const value =
      typeof element.value === "string" &&
      element.value.trim() !== "" &&
      element.value.trim() !== label
        ? ` value=${element.value.trim()}`
        : "";
    return `${element.element_index} ${normalizeRole(element.role)}${label ? ` ${label}` : ""}${value}`;
  });
  if (lines.length > 0) return lines.join("\n");
  if (typeof treeMarkdown !== "string") {
    throw new Error("CuaDriver window state tree_markdown must be a string");
  }
  return treeMarkdown;
}

function hasValidPermissionSchema(value) {
  return (
    hasExactKeys(value, [
      "accessibility",
      "direct_capture_status",
      "screen_recording",
      "screen_recording_capturable",
      "source",
    ]) &&
    typeof value.accessibility === "boolean" &&
    typeof value.screen_recording === "boolean" &&
    [true, false, null].includes(value.screen_recording_capturable) &&
    ["ready", "unavailable", "blocked_by_screen_recording", "not_checked"].includes(
      value.direct_capture_status,
    ) &&
    isPlainObject(value.source) &&
    hasExactKeys(value.source, [
      "attribution",
      "bundle_id",
      "disclaim_env",
      "executable",
      "note",
      "pid",
      "responsible_ppid",
    ]) &&
    typeof value.source.attribution === "string" &&
    (value.source.bundle_id === null || typeof value.source.bundle_id === "string") &&
    typeof value.source.disclaim_env === "boolean" &&
    typeof value.source.executable === "string" &&
    typeof value.source.note === "string" &&
    Number.isInteger(value.source.pid) &&
    value.source.pid > 0 &&
    Number.isInteger(value.source.responsible_ppid) &&
    value.source.responsible_ppid >= 0
  );
}

function hasValidListAppsSchema(value) {
  return (
    hasExactKeys(value, ["apps"]) &&
    Array.isArray(value.apps) &&
    value.apps.every(
      (app) =>
        isPlainObject(app) &&
        hasExactKeys(app, [
          "active",
          "bundle_id",
          "kind",
          "last_used",
          "launch_path",
          "name",
          "pid",
          "running",
          "windows",
        ]) &&
        typeof app.active === "boolean" &&
        (app.bundle_id === null || typeof app.bundle_id === "string") &&
        (app.kind === null || typeof app.kind === "string") &&
        (app.last_used === null || typeof app.last_used === "string") &&
        (app.launch_path === null || typeof app.launch_path === "string") &&
        typeof app.name === "string" &&
        Number.isInteger(app.pid) &&
        app.pid >= 0 &&
        typeof app.running === "boolean" &&
        Array.isArray(app.windows) &&
        app.windows.length === 0,
    )
  );
}

function hasValidBounds(value, keys) {
  return (
    isPlainObject(value) &&
    hasExactKeys(value, keys) &&
    keys.every((key) => Number.isFinite(value[key]))
  );
}

function hasValidLaunchWindow(value) {
  return (
    isPlainObject(value) &&
    hasExactKeys(value, ["app_name", "bounds", "is_on_screen", "pid", "title", "window_id"]) &&
    typeof value.app_name === "string" &&
    hasValidBounds(value.bounds, ["height", "width", "x", "y"]) &&
    typeof value.is_on_screen === "boolean" &&
    Number.isInteger(value.pid) &&
    value.pid > 0 &&
    typeof value.title === "string" &&
    Number.isInteger(value.window_id) &&
    value.window_id > 0
  );
}

function hasValidLaunchAppSchema(value) {
  return (
    hasExactKeys(value, ["bundle_id", "name", "pid", "windows"], ["self_activation_suppressed"]) &&
    Number.isInteger(value.pid) &&
    value.pid > 0 &&
    typeof value.bundle_id === "string" &&
    value.bundle_id !== "" &&
    typeof value.name === "string" &&
    Array.isArray(value.windows) &&
    value.windows.every(hasValidLaunchWindow) &&
    (value.self_activation_suppressed === undefined ||
      typeof value.self_activation_suppressed === "boolean")
  );
}

function hasValidListWindowsSchema(value) {
  return (
    hasExactKeys(value, ["current_space_id", "windows"]) &&
    value.current_space_id === null &&
    Array.isArray(value.windows) &&
    value.windows.every(
      (window) =>
        isPlainObject(window) &&
        hasExactKeys(window, [
          "app_name",
          "bounds",
          "is_on_screen",
          "layer",
          "on_current_space",
          "pid",
          "space_ids",
          "title",
          "window_id",
          "z_index",
        ]) &&
        typeof window.app_name === "string" &&
        hasValidBounds(window.bounds, ["height", "width", "x", "y"]) &&
        Number.isInteger(window.pid) &&
        window.pid > 0 &&
        Number.isInteger(window.window_id) &&
        window.window_id > 0 &&
        Number.isInteger(window.layer) &&
        typeof window.is_on_screen === "boolean" &&
        [true, false, null].includes(window.on_current_space) &&
        (window.space_ids === null ||
          (Array.isArray(window.space_ids) &&
            window.space_ids.every((spaceId) => Number.isSafeInteger(spaceId)))) &&
        typeof window.title === "string" &&
        Number.isFinite(window.z_index),
    )
  );
}

function hasValidWindowStateElement(element) {
  const validRange =
    (element.min === undefined && element.max === undefined) ||
    (Number.isFinite(element.min) && Number.isFinite(element.max));
  return (
    isPlainObject(element) &&
    hasExactKeys(
      element,
      ["depth", "element_index", "element_token", "role"],
      [
        "enabled",
        "frame",
        "label",
        "max",
        "min",
        "parent_index",
        "selected",
        "value",
        "value_description",
      ],
    ) &&
    Number.isInteger(element.depth) &&
    element.depth >= 0 &&
    Number.isInteger(element.element_index) &&
    element.element_index >= 0 &&
    typeof element.element_token === "string" &&
    element.element_token !== "" &&
    typeof element.role === "string" &&
    (element.enabled === undefined || typeof element.enabled === "boolean") &&
    (element.frame === undefined || hasValidBounds(element.frame, ["h", "w", "x", "y"])) &&
    (element.label === undefined || typeof element.label === "string") &&
    validRange &&
    (element.parent_index === undefined ||
      (Number.isInteger(element.parent_index) && element.parent_index >= 0)) &&
    (element.selected === undefined || typeof element.selected === "boolean") &&
    (element.value === undefined || typeof element.value === "string") &&
    (element.value_description === undefined || typeof element.value_description === "string")
  );
}

function hasValidWindowStateSchema(value) {
  return (
    hasExactKeys(
      value,
      [
        "_note",
        "element_count",
        "elements",
        "pid",
        "screenshot_height",
        "screenshot_mime_type",
        "screenshot_png_b64",
        "screenshot_width",
        "snapshot_id",
        "tree_markdown",
        "window_id",
      ],
      ["degraded", "degraded_reason", "escalation"],
    ) &&
    typeof value._note === "string" &&
    Number.isInteger(value.element_count) &&
    value.element_count >= 0 &&
    Number.isInteger(value.pid) &&
    value.pid > 0 &&
    Number.isInteger(value.window_id) &&
    value.window_id > 0 &&
    typeof value.snapshot_id === "string" &&
    value.snapshot_id !== "" &&
    typeof value.tree_markdown === "string" &&
    Array.isArray(value.elements) &&
    value.element_count === value.elements.length &&
    value.elements.every(hasValidWindowStateElement) &&
    Number.isInteger(value.screenshot_height) &&
    value.screenshot_height > 0 &&
    typeof value.screenshot_mime_type === "string" &&
    typeof value.screenshot_png_b64 === "string" &&
    Number.isInteger(value.screenshot_width) &&
    value.screenshot_width > 0 &&
    (value.degraded === undefined || value.degraded === true) &&
    (value.degraded_reason === undefined || typeof value.degraded_reason === "string") &&
    (value.escalation === undefined ||
      (isPlainObject(value.escalation) &&
        hasExactKeys(value.escalation, ["reason", "recommended"]) &&
        typeof value.escalation.reason === "string" &&
        typeof value.escalation.recommended === "string"))
  );
}

function hasValidStructuredToolSchema(tool, value) {
  switch (tool) {
    case "check_permissions":
      return hasValidPermissionSchema(value);
    case "list_apps":
      return hasValidListAppsSchema(value);
    case "launch_app":
      return hasValidLaunchAppSchema(value);
    case "list_windows":
      return hasValidListWindowsSchema(value);
    case "get_window_state":
      return hasValidWindowStateSchema(value);
    default:
      return false;
  }
}

function requireStructured(parsed, tool) {
  if (!isPlainObject(parsed.structured)) {
    throw new Error(`CuaDriver ${tool} did not return structured JSON`);
  }
  if (parsed.isError) {
    throw new Error(parsed.text || `CuaDriver ${tool} returned isError:true`);
  }
  if (!hasValidStructuredToolSchema(tool, parsed.structured)) {
    throw new Error(`malformed CuaDriver ${tool} structured output`);
  }
  return parsed.structured;
}

function actionErrorText(error) {
  if (error instanceof CuaProcessError) {
    return error.stderr.trim() || error.stdout.trim() || error.message;
  }
  return error?.message || String(error);
}

export class CuaDriver {
  constructor(options = {}) {
    if (!isPlainObject(options)) throw new TypeError("CuaDriver options must be an object");
    const allowedOptions = new Set([
      "appBundleId",
      "attachSocket",
      "binary",
      "cliPath",
      "daemonTeardownAttempts",
      "daemonTeardownPollMs",
      "dependencies",
      "driverAppPath",
      "maxImageBytes",
      "metadata",
      "processRunner",
      "runDir",
      "runId",
      "socketDirectory",
      "socketPath",
      "statusAttempts",
      "statusPollMs",
      "targetExitAttempts",
      "targetExitPollMs",
      "targetReadyAttempts",
      "targetReadyPollMs",
    ]);
    const unknownOptions = Object.keys(options).filter((key) => !allowedOptions.has(key));
    if (unknownOptions.length > 0) {
      throw new TypeError(`unknown CuaDriver option(s): ${unknownOptions.join(", ")}`);
    }
    if (options.binary !== undefined && options.cliPath !== undefined) {
      throw new TypeError("CuaDriver binary conflicts with cliPath");
    }
    const attachSocket = options.attachSocket ?? "";
    if (attachSocket !== "" && options.socketPath !== undefined) {
      throw new TypeError("CuaDriver attachSocket conflicts with owned socketPath");
    }
    if (attachSocket !== "") {
      throw new Error(
        "CuaDriver attach mode is disabled because upstream 0.12.6 has no authenticated socket transport",
      );
    }
    const runDir = options.runDir ?? os.tmpdir();
    const socketDirectory = options.socketDirectory ?? os.tmpdir();
    this.runDir = requireNonEmptyString(runDir, "CuaDriver runDir");
    if (!path.isAbsolute(this.runDir) || path.normalize(this.runDir) !== this.runDir) {
      throw new Error("CuaDriver runDir must be an absolute normalized path");
    }
    this.socketDirectory = requireNonEmptyString(socketDirectory, "CuaDriver socket directory");
    if (
      !path.isAbsolute(this.socketDirectory) ||
      path.normalize(this.socketDirectory) !== this.socketDirectory
    ) {
      throw new Error("CuaDriver socket directory must be an absolute normalized path");
    }
    this.cliPath = requireNonEmptyString(
      options.binary ?? options.cliPath ?? "cua-driver",
      "CuaDriver CLI path",
    );
    const driverAppPath = options.driverAppPath ?? "/Applications/CuaDriver.app";
    this.driverAppPath = requireNonEmptyString(driverAppPath, "CuaDriver.app path");
    this.configuredAppBundleId =
      options.appBundleId === undefined
        ? ""
        : requireNonEmptyString(options.appBundleId, "CuaDriver appBundleId");
    this.processRunner = options.processRunner ?? createCuaProcessRunner();
    const runId = options.runId ?? randomUUID();
    this.runId = requireNonEmptyString(runId, "CuaDriver runId").replace(/[^a-zA-Z0-9._-]/g, "-");
    this.attachMode = false;
    if (options.socketPath !== undefined) {
      this.socketPath = requireNonEmptyString(options.socketPath, "CuaDriver owned socketPath");
    } else {
      this.socketPath = path.join(this.socketDirectory, `nixmac-cua-${this.runId}.sock`);
    }
    if (!path.isAbsolute(this.socketPath) || path.normalize(this.socketPath) !== this.socketPath) {
      throw new Error("CuaDriver socket path must be an absolute normalized path");
    }
    if (Buffer.byteLength(this.socketPath, "utf8") > 103) {
      throw new Error("CuaDriver Unix socket path exceeds 103 UTF-8 bytes");
    }
    this.maxImageBytes = options.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES;
    if (!Number.isInteger(this.maxImageBytes) || this.maxImageBytes <= 0) {
      throw new TypeError("CuaDriver maxImageBytes must be a positive integer");
    }
    this.metadata = options.metadata ?? pinnedCuaDriverMetadata;
    this.statusAttempts = options.statusAttempts ?? 20;
    this.statusPollMs = options.statusPollMs ?? 250;
    this.daemonTeardownAttempts = options.daemonTeardownAttempts ?? 20;
    this.daemonTeardownPollMs = options.daemonTeardownPollMs ?? 250;
    this.targetReadyAttempts = options.targetReadyAttempts ?? 20;
    this.targetReadyPollMs = options.targetReadyPollMs ?? 250;
    this.targetExitAttempts = options.targetExitAttempts ?? 20;
    this.targetExitPollMs = options.targetExitPollMs ?? 250;
    this.dependencies = {
      canonicalPath: defaultCanonicalPath,
      inspectApplicationInstance: (instance) =>
        defaultInspectApplicationInstance(instance, this.processRunner),
      lstat,
      listProcessInstances: (executablePath) =>
        defaultListProcessInstances(executablePath, this.processRunner),
      queryProcessInstance: (pid) => defaultQueryProcessInstance(pid, this.processRunner),
      readBundleIdentity: (appPath, options) =>
        defaultReadBundleIdentity(appPath, this.processRunner, options),
      readExecutableIdentity: (executablePath) =>
        defaultReadExecutableIdentity(executablePath, this.processRunner),
      resolveBundleExecutablePath: (appPath) =>
        defaultResolveBundleExecutablePath(appPath, this.processRunner),
      resolveExecutablePath: (inputPath) =>
        defaultResolveExecutablePath(inputPath, this.processRunner),
      sleep: (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
      terminateApplicationInstance: (instance, options) =>
        defaultTerminateApplicationInstance(instance, options, this.processRunner),
      ...options.dependencies,
    };
    this.connected = false;
    this.startedDaemon = false;
    this.daemonPeer = null;
    this.daemonAttestation = null;
    this.canonicalDriverAppPath = "";
    this.canonicalDaemonExecutablePath = "";
    this.ownedTarget = null;
    this.targetAttestation = null;
    this.boundTarget = null;
    this.latestSnapshot = null;
    this.turnId = 0;
  }

  async _run(args, options) {
    return this.processRunner.run(this.cliPath, args, options);
  }

  async _assertBoundDaemonEndpoint(stage) {
    const boundPeer = this.daemonPeer;
    try {
      if (!this.startedDaemon || !boundPeer?.socketIdentity) {
        throw new Error(`CuaDriver has no fully bound owned daemon before ${stage}`);
      }
      const socketIdentity = await this._readSocketIdentity();
      if (
        socketIdentity.dev !== boundPeer.socketIdentity.dev ||
        socketIdentity.ino !== boundPeer.socketIdentity.ino
      ) {
        throw new Error(`CuaDriver daemon socket object changed during RPC ${stage}`);
      }
      const listener = await this._resolveSocketListener();
      if (!sameProcessInstance(listener, boundPeer)) {
        throw new Error(`CuaDriver daemon listener process instance changed during RPC ${stage}`);
      }
      await this._assertVerifiedDaemonPeer(listener);
    } catch (error) {
      if (!boundPeer) throw error;
      try {
        await this._assertVerifiedDaemonPeer(boundPeer, { full: true });
      } catch (attestationError) {
        throw new AggregateError(
          [error, attestationError],
          `CuaDriver daemon endpoint continuity and failure attestation failed during ${stage}`,
        );
      }
      throw error;
    }
  }

  async _call(tool, input, { maxOutputBytes } = {}) {
    const args = ["call", tool, JSON.stringify(input)];
    args.push("--socket", this.socketPath);
    await this._assertBoundDaemonEndpoint(`before ${tool}`);
    let result;
    let operationError;
    try {
      result = await this._run(args, maxOutputBytes ? { maxOutputBytes } : undefined);
    } catch (error) {
      operationError = error;
    }
    let postconditionError;
    try {
      await this._assertBoundDaemonEndpoint(`after ${tool}`);
    } catch (error) {
      postconditionError = error;
    }
    let failureAttestationError;
    if (operationError && this.daemonPeer) {
      try {
        await this._assertVerifiedDaemonPeer(this.daemonPeer, { full: true });
      } catch (error) {
        failureAttestationError = error;
      }
    }
    if (failureAttestationError) {
      throw new AggregateError(
        [
          operationError,
          ...(postconditionError ? [postconditionError] : []),
          failureAttestationError,
        ],
        `CuaDriver ${tool} failed and daemon failure attestation failed`,
      );
    }
    if (operationError && postconditionError) {
      throw new AggregateError(
        [operationError, postconditionError],
        `CuaDriver ${tool} failed and daemon endpoint postcondition failed`,
      );
    }
    if (postconditionError) throw postconditionError;
    if (operationError) throw operationError;
    return parseCuaCliOutput(result.stdout, {
      maxBytes: maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    });
  }

  async _callStructured(tool, input, options) {
    return requireStructured(await this._call(tool, input, options), tool);
  }

  async _callForTarget(target, tool, input, options) {
    await this._assertOwnedTargetProcess(target);
    let result;
    let operationError;
    try {
      result = await this._call(tool, input, options);
    } catch (error) {
      operationError = error;
    }
    let postconditionError;
    try {
      await this._assertOwnedTargetProcess(target);
    } catch (error) {
      postconditionError = error;
    }
    let failureAttestationError;
    if (operationError) {
      try {
        await this._readAndAssertTargetIdentity(target);
      } catch (error) {
        failureAttestationError = error;
      }
    }
    if (failureAttestationError) {
      throw new AggregateError(
        [
          operationError,
          ...(postconditionError ? [postconditionError] : []),
          failureAttestationError,
        ],
        `CuaDriver ${tool} failed and target failure attestation failed`,
      );
    }
    if (operationError && postconditionError) {
      throw new AggregateError(
        [operationError, postconditionError],
        `CuaDriver ${tool} failed and target process-instance postcondition failed`,
      );
    }
    if (postconditionError) throw postconditionError;
    if (operationError) throw operationError;
    return result;
  }

  async _callStructuredForTarget(target, tool, input, options) {
    return requireStructured(await this._callForTarget(target, tool, input, options), tool);
  }

  async _pollStatus() {
    let lastError;
    for (let attempt = 1; attempt <= this.statusAttempts; attempt += 1) {
      try {
        await this._run(["status", "--socket", this.socketPath]);
        return;
      } catch (error) {
        lastError = error;
        if (attempt < this.statusAttempts) {
          await this.dependencies.sleep(this.statusPollMs);
        }
      }
    }
    throw new Error(
      `CuaDriver daemon did not become ready at ${this.socketPath}: ${actionErrorText(lastError)}`,
    );
  }

  _assertPinnedDriverIdentity(identity) {
    assertIdentity(
      identity,
      {
        bundleId: this.metadata.app.bundle_id,
        shortVersion: this.metadata.app.short_version,
        buildVersion: this.metadata.app.build_version,
        digestSha256: this.metadata.app.content_tree_sha256,
        codeSigningDigestSha256: this.metadata.app.code_signing_digest_sha256,
        developerId: this.metadata.app.developer_id,
        teamIdentifier: this.metadata.app.team_identifier,
      },
      "CuaDriver.app",
    );
  }

  async _resolveSocketListener({ allowMissing = false, canonicalizeExecutable = true } = {}) {
    let canonicalSocketPath = this.daemonPeer?.socketPath ?? "";
    if (!canonicalSocketPath) {
      try {
        canonicalSocketPath = await this.dependencies.canonicalPath(this.socketPath);
      } catch (error) {
        if (allowMissing && error?.code === "ENOENT") return null;
        throw error;
      }
      if (canonicalSocketPath !== this.socketPath) {
        throw new Error(`CuaDriver socket path must be canonical: expected ${canonicalSocketPath}`);
      }
    }
    let lsofResult;
    try {
      lsofResult = await this.processRunner.run("/usr/sbin/lsof", [
        "-nP",
        "-Fpcn",
        "-a",
        "-U",
        canonicalSocketPath,
      ]);
    } catch (error) {
      if (allowMissing && error instanceof CuaProcessError && error.code === 1) return null;
      throw error;
    }
    if (allowMissing && lsofResult.stdout.trim() === "") return null;
    const socketOwner = parseCuaSocketOwner(lsofResult.stdout, canonicalSocketPath);
    const processInstance = await this.dependencies.queryProcessInstance(socketOwner.pid);
    const executable = canonicalizeExecutable
      ? await this.dependencies.canonicalPath(processInstance.executable)
      : processInstance.executable;
    return Object.freeze({
      birthMarker: processInstance.birthMarker,
      executable,
      pid: socketOwner.pid,
      socketPath: canonicalSocketPath,
      startSec: processInstance.startSec,
      startUsec: processInstance.startUsec,
    });
  }

  async _readSocketIdentity({ allowMissing = false } = {}) {
    let stats;
    try {
      stats = await this.dependencies.lstat(this.socketPath);
    } catch (error) {
      if (allowMissing && error?.code === "ENOENT") return null;
      throw error;
    }
    if (
      stats.isSymbolicLink() ||
      !stats.isSocket() ||
      !Number.isInteger(stats.dev) ||
      !Number.isInteger(stats.ino)
    ) {
      throw new Error("CuaDriver owned socket path is not a stable Unix socket object");
    }
    const canonicalSocketPath = await this.dependencies.canonicalPath(this.socketPath);
    if (canonicalSocketPath !== this.socketPath) {
      throw new Error(`CuaDriver socket path must be canonical: expected ${canonicalSocketPath}`);
    }
    return Object.freeze({ dev: stats.dev, ino: stats.ino });
  }

  async _assertVerifiedDaemonPeer(peer, { full = false } = {}) {
    if (!this.canonicalDriverAppPath || peer.executable !== this.canonicalDaemonExecutablePath) {
      throw new Error("CuaDriver socket owner executable is outside the verified CuaDriver.app");
    }
    const key = processInstanceKey(peer);
    if (!full && this.daemonAttestation?.processKey === key) return;
    const identity = await this.dependencies.readBundleIdentity(this.canonicalDriverAppPath, {
      requireDeveloperSigningIdentity: true,
    });
    this._assertPinnedDriverIdentity(identity);
    this.daemonAttestation = Object.freeze({
      identity: Object.freeze({ ...identity }),
      processKey: key,
    });
  }

  async _daemonProcessState(peer = this.daemonPeer) {
    try {
      const instance = await this.dependencies.queryProcessInstance(peer.pid);
      return Object.freeze({ ...instance, exists: true });
    } catch (error) {
      if (error?.code === "ESRCH") {
        return Object.freeze({
          birthMarker: "",
          executable: "",
          exists: false,
          pid: peer.pid,
          startSec: 0,
          startUsec: 0,
        });
      }
      throw error;
    }
  }

  async _bindApplicationInstance(instance) {
    const before = await this.dependencies.queryProcessInstance(instance.pid);
    const beforeExecutable = await this.dependencies.canonicalPath(before.executable);
    if (!sameProcessInstance({ ...before, executable: beforeExecutable }, instance)) {
      throw new Error(`CuaDriver process instance changed before application binding`);
    }
    const application = await this.dependencies.inspectApplicationInstance(instance);
    if (
      !isPlainObject(application) ||
      application.pid !== instance.pid ||
      typeof application.executable !== "string" ||
      application.executable === "" ||
      !Number.isSafeInteger(application.launchDateMicros) ||
      application.launchDateMicros <= 0
    ) {
      throw new Error("CuaDriver application-instance inspection returned malformed identity");
    }
    const applicationExecutable = await this.dependencies.canonicalPath(application.executable);
    const after = await this.dependencies.queryProcessInstance(instance.pid);
    const afterExecutable = await this.dependencies.canonicalPath(after.executable);
    if (
      !sameProcessInstance({ ...after, executable: afterExecutable }, instance) ||
      applicationExecutable !== instance.executable
    ) {
      throw new Error(`CuaDriver process instance changed during application binding`);
    }
    return Object.freeze({
      ...instance,
      applicationExecutable,
      applicationLaunchDateMicros: application.launchDateMicros,
    });
  }

  async _pollNewDaemonInstance(previousInstances) {
    const previousKeys = new Set(
      previousInstances.map(
        (instance) => `${instance.pid}:${instance.birthMarker}:${instance.executable}`,
      ),
    );
    let lastError;
    for (let attempt = 1; attempt <= this.statusAttempts; attempt += 1) {
      try {
        const currentInstances = await this.dependencies.listProcessInstances(
          this.canonicalDaemonExecutablePath,
        );
        const newInstances = currentInstances.filter(
          (instance) =>
            !previousKeys.has(`${instance.pid}:${instance.birthMarker}:${instance.executable}`),
        );
        if (newInstances.length > 1) {
          throw new Error("CuaDriver launch created multiple new daemon process instances");
        }
        if (newInstances.length === 1) {
          const listedCandidate = newInstances[0];
          this.daemonPeer = Object.freeze({
            ...listedCandidate,
            socketIdentity: null,
            socketPath: this.socketPath,
          });
          const candidate = await this.dependencies.queryProcessInstance(listedCandidate.pid);
          const executable = await this.dependencies.canonicalPath(candidate.executable);
          const provisional = Object.freeze({
            ...candidate,
            executable,
            socketIdentity: null,
            socketPath: this.socketPath,
          });
          if (!sameProcessInstance(provisional, { ...listedCandidate, executable })) {
            throw new Error("CuaDriver new daemon process instance changed during capture");
          }
          const applicationBound = await this._bindApplicationInstance(provisional);
          this.daemonPeer = applicationBound;
          await this._assertVerifiedDaemonPeer(applicationBound);
          return applicationBound;
        }
        lastError = new Error("CuaDriver launch has not produced a new daemon process");
      } catch (error) {
        lastError = error;
        if (/multiple new daemon process instances/.test(error.message)) throw error;
      }
      if (attempt < this.statusAttempts) {
        await this.dependencies.sleep(this.statusPollMs);
      }
    }
    throw new Error(
      `CuaDriver did not produce exactly one new daemon process instance: ${actionErrorText(
        lastError,
      )}`,
    );
  }

  _clearDaemonOwnership() {
    this.startedDaemon = false;
    this.daemonPeer = null;
    this.daemonAttestation = null;
  }

  async _terminateBoundApplication(instance, { force }) {
    if (
      typeof instance?.applicationExecutable !== "string" ||
      instance.applicationExecutable === "" ||
      !Number.isSafeInteger(instance.applicationLaunchDateMicros) ||
      instance.applicationLaunchDateMicros <= 0
    ) {
      throw new Error(
        `CuaDriver cannot terminate pid ${instance?.pid ?? "<unknown>"} without an exact NSRunningApplication identity`,
      );
    }
    await this.dependencies.terminateApplicationInstance(instance, { force });
  }

  async _waitForOwnedDaemonExit(boundPeer) {
    for (let attempt = 1; attempt <= this.daemonTeardownAttempts; attempt += 1) {
      const processState = await this._daemonProcessState(boundPeer);
      if (!processState.exists || !sameProcessInstance(processState, boundPeer)) return;
      if (attempt < this.daemonTeardownAttempts) {
        await this.dependencies.sleep(this.daemonTeardownPollMs);
      }
    }
    throw new Error(
      `CuaDriver bound daemon did not terminate after ${this.daemonTeardownAttempts} checks`,
    );
  }

  async _cleanupProvisionalDaemon(boundPeer) {
    let capturedSocketIdentity = null;
    const socketIdentity = await this._readSocketIdentity({ allowMissing: true });
    if (socketIdentity) {
      const listener = await this._resolveSocketListener({
        allowMissing: true,
        canonicalizeExecutable: false,
      });
      if (!listener || !sameProcessInstance(listener, boundPeer)) {
        throw new Error("CuaDriver provisional daemon socket is contaminated");
      }
      capturedSocketIdentity = socketIdentity;
    }
    const processState = await this._daemonProcessState(boundPeer);
    if (processState.exists && sameProcessInstance(processState, boundPeer)) {
      await this._terminateBoundApplication(boundPeer, { force: false });
      await this._waitForOwnedDaemonExit(boundPeer);
    }
    const postListener = await this._resolveSocketListener({
      allowMissing: true,
      canonicalizeExecutable: false,
    });
    if (postListener) {
      throw new Error("CuaDriver provisional daemon listener remains after termination");
    }
    const remainingSocket = await this._readSocketIdentity({ allowMissing: true });
    if (remainingSocket) {
      if (
        !capturedSocketIdentity ||
        remainingSocket.dev !== capturedSocketIdentity.dev ||
        remainingSocket.ino !== capturedSocketIdentity.ino
      ) {
        throw new Error("CuaDriver provisional daemon socket was replaced during cleanup");
      }
      throw new Error("CuaDriver stale owned socket requires controller quarantine");
    }
    this._clearDaemonOwnership();
  }

  async _cleanupOwnedDaemon() {
    if (!this.startedDaemon) return;
    const boundPeer = this.daemonPeer;
    if (!boundPeer) {
      throw new Error("CuaDriver cannot stop an owned daemon without a bound OS-derived peer");
    }
    await this._assertVerifiedDaemonPeer(boundPeer, { full: true });
    if (!boundPeer.socketIdentity) {
      await this._cleanupProvisionalDaemon(boundPeer);
      return;
    }
    const currentSocketIdentity = await this._readSocketIdentity({ allowMissing: true });
    if (!currentSocketIdentity) {
      const processState = await this._daemonProcessState(boundPeer);
      if (!processState.exists || !sameProcessInstance(processState, boundPeer)) {
        this._clearDaemonOwnership();
        return;
      }
      throw new Error("CuaDriver bound daemon pid is still alive without its socket");
    }
    if (
      currentSocketIdentity.dev !== boundPeer.socketIdentity.dev ||
      currentSocketIdentity.ino !== boundPeer.socketIdentity.ino
    ) {
      throw new Error("CuaDriver socket object changed before stop");
    }
    const currentListener = await this._resolveSocketListener({ allowMissing: true });
    if (!currentListener) {
      const processState = await this._daemonProcessState(boundPeer);
      if (!processState.exists || !sameProcessInstance(processState, boundPeer)) {
        throw new Error("CuaDriver stale owned socket requires controller quarantine");
      }
      throw new Error("CuaDriver bound daemon pid is still alive without its socket listener");
    }
    if (
      currentListener.pid !== boundPeer.pid ||
      currentListener.birthMarker !== boundPeer.birthMarker ||
      currentListener.executable !== boundPeer.executable
    ) {
      throw new Error("CuaDriver socket listener changed before stop");
    }
    await this._assertVerifiedDaemonPeer(currentListener);
    await this._run(["stop", "--socket", boundPeer.socketPath]);

    let lastProofError;
    for (let attempt = 1; attempt <= this.daemonTeardownAttempts; attempt += 1) {
      let listener;
      let processState;
      let socketIdentity;
      try {
        listener = await this._resolveSocketListener({ allowMissing: true });
        processState = await this._daemonProcessState(boundPeer);
        socketIdentity = await this._readSocketIdentity({ allowMissing: true });
        lastProofError = null;
      } catch (error) {
        lastProofError = error;
      }
      if (!lastProofError) {
        if (listener && !sameProcessInstance(listener, boundPeer)) {
          throw new Error("CuaDriver replacement listener contamination after stop");
        }
        if (
          socketIdentity &&
          (socketIdentity.dev !== boundPeer.socketIdentity.dev ||
            socketIdentity.ino !== boundPeer.socketIdentity.ino)
        ) {
          throw new Error("CuaDriver replacement socket contamination after stop");
        }
        const sameListener = listener !== null;
        const sameProcess = processState.exists && sameProcessInstance(processState, boundPeer);
        if (!sameListener && !sameProcess && socketIdentity) {
          throw new Error("CuaDriver stale owned socket requires controller quarantine");
        }
        if (!sameListener && !sameProcess && !socketIdentity) {
          this._clearDaemonOwnership();
          return;
        }
      }
      if (attempt < this.daemonTeardownAttempts) {
        await this.dependencies.sleep(this.daemonTeardownPollMs);
      }
    }
    throw new Error(
      `CuaDriver bound daemon or socket did not terminate after ${this.daemonTeardownAttempts} checks${
        lastProofError ? `: ${actionErrorText(lastProofError)}` : ""
      }`,
    );
  }

  async connect() {
    if (this.connected) return;
    this.cliPath = await this.dependencies.resolveExecutablePath(this.cliPath);
    if (!path.isAbsolute(this.cliPath) || path.normalize(this.cliPath) !== this.cliPath) {
      throw new Error("CuaDriver CLI must resolve to an absolute normalized path");
    }
    const cliIdentity = await this.dependencies.readExecutableIdentity(this.cliPath);
    assertIdentity(
      cliIdentity,
      {
        digestSha256: this.metadata.cli.sha256,
        codeSigningDigestSha256: this.metadata.cli.code_signing_digest_sha256,
        developerId: this.metadata.cli.developer_id,
        teamIdentifier: this.metadata.cli.team_identifier,
      },
      "CuaDriver CLI",
    );
    const versionResult = await this._run(["--version"]);
    const actualVersion = versionResult.stdout.trim();
    if (actualVersion !== this.metadata.cli.version_output) {
      throw new Error(
        `CuaDriver CLI version mismatch: expected ${this.metadata.cli.version_output}, got ${actualVersion}`,
      );
    }
    this.canonicalDriverAppPath = await this.dependencies.canonicalPath(this.driverAppPath);
    requireAbsoluteCanonicalInput(this.driverAppPath, this.canonicalDriverAppPath);
    this.canonicalDaemonExecutablePath = await this.dependencies.canonicalPath(
      path.join(this.canonicalDriverAppPath, "Contents", "MacOS", "cua-driver"),
    );
    const appIdentity = await this.dependencies.readBundleIdentity(this.canonicalDriverAppPath, {
      requireDeveloperSigningIdentity: true,
    });
    this._assertPinnedDriverIdentity(appIdentity);

    try {
      try {
        await this.dependencies.lstat(this.socketPath);
        throw new Error(`CuaDriver owned socket path already exists: ${this.socketPath}`);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      const previousDaemonInstances = await this.dependencies.listProcessInstances(
        this.canonicalDaemonExecutablePath,
      );
      this.startedDaemon = true;
      let openError;
      try {
        await this.processRunner.run("/usr/bin/open", [
          "-n",
          "-g",
          this.canonicalDriverAppPath,
          "--args",
          "serve",
          "--socket",
          this.socketPath,
        ]);
      } catch (error) {
        openError = error;
      }
      try {
        this.daemonPeer = await this._pollNewDaemonInstance(previousDaemonInstances);
      } catch (captureError) {
        if (openError) {
          throw new AggregateError(
            [openError, captureError],
            `CuaDriver open failed and daemon launch ownership is uncertain: ${actionErrorText(
              openError,
            )}; ${actionErrorText(captureError)}`,
          );
        }
        throw captureError;
      }
      if (openError) throw openError;
      await this._pollStatus();
      const socketIdentity = await this._readSocketIdentity();
      const socketListener = await this._resolveSocketListener();
      if (!sameProcessInstance(socketListener, this.daemonPeer)) {
        throw new Error("CuaDriver socket listener does not match the launched daemon instance");
      }
      await this._assertVerifiedDaemonPeer(socketListener);
      this.daemonPeer = Object.freeze({ ...socketListener, socketIdentity });
      const permissions = await this._callStructured("check_permissions", {
        prompt: false,
      });
      if (permissions.accessibility !== true || permissions.screen_recording !== true) {
        throw new Error("CuaDriver requires Accessibility and Screen Recording permissions");
      }
      if (
        permissions.source?.attribution !== "driver-daemon" ||
        permissions.source?.bundle_id !== this.metadata.app.bundle_id
      ) {
        throw new Error(
          "CuaDriver permissions must be attributed to the installed CuaDriver.app daemon",
        );
      }
      let sourceExecutable;
      try {
        sourceExecutable = await this.dependencies.canonicalPath(
          requireNonEmptyString(
            permissions.source?.executable,
            "CuaDriver permissions source executable",
          ),
        );
      } catch (error) {
        throw new Error(
          `CuaDriver permissions source executable could not be canonicalized: ${actionErrorText(error)}`,
        );
      }
      if (sourceExecutable !== socketListener.executable) {
        throw new Error(
          "CuaDriver permissions source executable does not match the OS-derived socket owner",
        );
      }
      this.connected = true;
    } catch (error) {
      if (this.startedDaemon) {
        try {
          await this.close();
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            `CuaDriver startup failed and exact daemon cleanup failed: ${actionErrorText(
              error,
            )}; ${actionErrorText(cleanupError)}`,
          );
        }
      }
      throw error;
    }
  }

  async _registeredTargetRecords(appBundleId, appPath, { expectedRunningPid = 0 } = {}) {
    const listing = await this._callStructured("list_apps", {});
    if (!Array.isArray(listing.apps)) {
      throw new Error("CuaDriver list_apps response is missing apps");
    }
    const bundleRecords = listing.apps.filter(
      (app) => isPlainObject(app) && app.bundle_id === appBundleId,
    );
    const runningRecords = bundleRecords.filter(
      (record) => record.running === true || Number(record.pid) > 0,
    );
    if (expectedRunningPid === 0 && runningRecords.length > 0) {
      throw new Error(
        `competing ${appBundleId} process is already running with pid ${runningRecords[0].pid}`,
      );
    }
    if (
      expectedRunningPid > 0 &&
      (runningRecords.length !== 1 || runningRecords[0].pid !== expectedRunningPid)
    ) {
      throw new Error(
        `CuaDriver list_apps did not resolve ${appBundleId} to launched pid ${expectedRunningPid}`,
      );
    }
    const records = [];
    for (const record of bundleRecords) {
      if (typeof record.launch_path !== "string" || record.launch_path === "") continue;
      let launchPath;
      try {
        launchPath = await this.dependencies.canonicalPath(record.launch_path);
      } catch {
        continue;
      }
      records.push({ ...record, canonicalLaunchPath: launchPath });
    }
    const exact = records.filter((record) => record.canonicalLaunchPath === appPath);
    if (exact.length !== 1 || records.some((record) => record.canonicalLaunchPath !== appPath)) {
      throw new Error(`CuaDriver could not uniquely bind ${appBundleId} to staged app ${appPath}`);
    }
    return exact[0];
  }

  async _pollNewTargetInstance(
    previousInstances,
    executable,
    { appBundleId, appPath, digestSha256 },
  ) {
    const previousKeys = new Set(
      previousInstances.map(
        (instance) => `${instance.pid}:${instance.birthMarker}:${instance.executable}`,
      ),
    );
    let lastError;
    for (let attempt = 1; attempt <= this.targetReadyAttempts; attempt += 1) {
      try {
        const currentInstances = await this.dependencies.listProcessInstances(executable);
        const newInstances = currentInstances.filter(
          (instance) =>
            !previousKeys.has(`${instance.pid}:${instance.birthMarker}:${instance.executable}`),
        );
        if (newInstances.length > 1) {
          throw new Error("CuaDriver launch created multiple new target process instances");
        }
        if (newInstances.length === 1) {
          const candidate = newInstances[0];
          const provisional = Object.freeze({
            appBundleId,
            appPath,
            birthMarker: candidate.birthMarker,
            digestSha256,
            executable: candidate.executable,
            pid: candidate.pid,
            provisional: true,
            startSec: candidate.startSec,
            startUsec: candidate.startUsec,
          });
          if (this.ownedTarget && !sameProcessInstance(this.ownedTarget, provisional)) {
            throw new Error("CuaDriver new target process instance changed during capture");
          }
          this.ownedTarget = provisional;
          this.ownedTarget = await this._bindApplicationInstance(provisional);
          return this.ownedTarget;
        }
        lastError = new Error("CuaDriver launch has not produced a new target process");
      } catch (error) {
        lastError = error;
        if (
          /multiple new target process instances|target process instance changed during capture/.test(
            error.message,
          )
        ) {
          throw error;
        }
      }
      if (attempt < this.targetReadyAttempts) {
        await this.dependencies.sleep(this.targetReadyPollMs);
      }
    }
    throw new Error(
      `CuaDriver did not produce exactly one new target process instance: ${actionErrorText(
        lastError,
      )}`,
    );
  }

  async _readAndAssertTargetIdentity(target) {
    const identity = await this.dependencies.readBundleIdentity(target.appPath);
    if (identity.bundleId !== target.appBundleId || identity.digestSha256 !== target.digestSha256) {
      throw new Error(`refusing cleanup for pid ${target.pid}: owned target identity changed`);
    }
    this.targetAttestation = Object.freeze({
      identity: Object.freeze({ ...identity }),
      processKey: processInstanceKey(target),
    });
    return identity;
  }

  async _assertOwnedTargetProcess(target = this.ownedTarget, { full = false } = {}) {
    if (!target) throw new Error("CuaDriver has no owned target process");
    let instance;
    let canonicalExecutable;
    try {
      instance = await this.dependencies.queryProcessInstance(target.pid);
      canonicalExecutable = await this.dependencies.canonicalPath(instance.executable);
      if (
        instance.pid !== target.pid ||
        instance.birthMarker !== target.birthMarker ||
        canonicalExecutable !== target.executable
      ) {
        throw new Error(`CuaDriver target process instance changed for pid ${target.pid}`);
      }
      if (!pathIsWithin(canonicalExecutable, path.join(target.appPath, "Contents", "MacOS"))) {
        throw new Error(
          `refusing cleanup for pid ${target.pid}: executable is outside the owned target bundle`,
        );
      }
    } catch (error) {
      try {
        await this._readAndAssertTargetIdentity(target);
      } catch (attestationError) {
        throw new AggregateError(
          [error, attestationError],
          `CuaDriver target continuity and failure attestation failed for pid ${target.pid}`,
        );
      }
      throw error;
    }
    const identity =
      full || this.targetAttestation?.processKey !== processInstanceKey(target)
        ? await this._readAndAssertTargetIdentity(target)
        : this.targetAttestation.identity;
    return Object.freeze({ ...instance, executable: canonicalExecutable, identity });
  }

  _clearOwnedTarget(target) {
    if (this.boundTarget?.pid === target.pid) this.boundTarget = null;
    this.latestSnapshot = null;
    this.ownedTarget = null;
    this.targetAttestation = null;
  }

  async _cleanupOwnedTarget() {
    const target = this.ownedTarget;
    if (!target) return;
    await this._readAndAssertTargetIdentity(target);
    let currentInstance;
    try {
      currentInstance = await this.dependencies.queryProcessInstance(target.pid);
    } catch (error) {
      if (error?.code === "ESRCH") {
        this._clearOwnedTarget(target);
        return;
      }
      throw error;
    }
    if (
      currentInstance.birthMarker !== target.birthMarker ||
      currentInstance.executable !== target.executable
    ) {
      this._clearOwnedTarget(target);
      return;
    }
    await this._terminateBoundApplication(target, { force: true });
    let stillOwned = false;
    for (let attempt = 1; attempt <= this.targetExitAttempts; attempt += 1) {
      let instance;
      try {
        instance = await this.dependencies.queryProcessInstance(target.pid);
      } catch (error) {
        if (error?.code === "ESRCH") {
          stillOwned = false;
          break;
        }
        throw error;
      }
      if (
        instance.birthMarker !== target.birthMarker ||
        instance.executable !== target.executable
      ) {
        stillOwned = false;
        break;
      }
      stillOwned = true;
      if (attempt < this.targetExitAttempts) {
        await this.dependencies.sleep(this.targetExitPollMs);
      }
    }
    if (stillOwned) {
      throw new Error(
        `owned target pid ${target.pid} did not exit after ${this.targetExitAttempts} checks`,
      );
    }
    this._clearOwnedTarget(target);
  }

  async prepareTarget({ appBundleId, appPath } = {}) {
    if (!this.connected) throw new Error("CuaDriver must connect before prepareTarget");
    const bundleId = requireNonEmptyString(
      appBundleId ?? this.configuredAppBundleId,
      "target appBundleId",
    );
    if (this.configuredAppBundleId && bundleId !== this.configuredAppBundleId) {
      throw new Error(`target appBundleId conflicts with configured ${this.configuredAppBundleId}`);
    }
    const inputPath = requireNonEmptyString(appPath, "target appPath");
    const canonicalAppPath = await this.dependencies.canonicalPath(inputPath);
    requireAbsoluteCanonicalInput(inputPath, canonicalAppPath);
    const preflightIdentity = await this.dependencies.readBundleIdentity(canonicalAppPath);
    if (preflightIdentity.bundleId !== bundleId) {
      throw new Error(
        `target bundle ID mismatch: expected ${bundleId}, got ${preflightIdentity.bundleId}`,
      );
    }

    const preflightRecord = await this._registeredTargetRecords(bundleId, canonicalAppPath);
    if (preflightRecord.running === true || Number(preflightRecord.pid) > 0) {
      throw new Error(
        `competing ${bundleId} process is already running with pid ${preflightRecord.pid}`,
      );
    }

    const stagedExecutable = await this.dependencies.resolveBundleExecutablePath(canonicalAppPath);
    if (!pathIsWithin(stagedExecutable, path.join(canonicalAppPath, "Contents", "MacOS"))) {
      throw new Error("target CFBundleExecutable resolves outside the staged target bundle");
    }
    const previousTargetInstances = await this.dependencies.listProcessInstances(stagedExecutable);
    let launched;
    let launchError;
    try {
      launched = await this._callStructured("launch_app", {
        bundle_id: bundleId,
      });
    } catch (error) {
      launchError = error;
    }
    let provisionalTarget;
    try {
      provisionalTarget = await this._pollNewTargetInstance(
        previousTargetInstances,
        stagedExecutable,
        {
          appBundleId: bundleId,
          appPath: canonicalAppPath,
          digestSha256: preflightIdentity.digestSha256,
        },
      );
    } catch (captureError) {
      if (launchError) {
        throw new AggregateError(
          [launchError, captureError],
          `CuaDriver launch_app failed and target process capture failed: ${actionErrorText(
            launchError,
          )}; ${actionErrorText(captureError)}`,
        );
      }
      throw captureError;
    }
    try {
      if (launchError) throw launchError;
      if (!Number.isInteger(launched.pid) || launched.pid <= 0) {
        throw new Error("CuaDriver launch_app returned an invalid pid");
      }
      if (launched.bundle_id !== bundleId) {
        throw new Error(
          `CuaDriver launch_app bundle mismatch: expected ${bundleId}, got ${launched.bundle_id}`,
        );
      }
      if (launched.pid !== provisionalTarget.pid) {
        throw new Error(
          `CuaDriver launch_app pid ${launched.pid} does not match captured process ${provisionalTarget.pid}`,
        );
      }
      const pid = provisionalTarget.pid;
      const launchedInstance = await this.dependencies.queryProcessInstance(pid);
      const launchedExecutable = await this.dependencies.canonicalPath(launchedInstance.executable);
      if (
        !sameProcessInstance(
          { ...launchedInstance, executable: launchedExecutable },
          provisionalTarget,
        )
      ) {
        throw new Error(`CuaDriver launched process instance changed for pid ${pid}`);
      }
      if (
        launchedExecutable !== stagedExecutable ||
        !pathIsWithin(launchedExecutable, path.join(canonicalAppPath, "Contents", "MacOS"))
      ) {
        throw new Error(`CuaDriver launched pid ${pid} outside the staged target bundle`);
      }
      const postLaunchIdentity = await this.dependencies.readBundleIdentity(canonicalAppPath);
      if (
        postLaunchIdentity.bundleId !== bundleId ||
        postLaunchIdentity.digestSha256 !== preflightIdentity.digestSha256
      ) {
        throw new Error(`CuaDriver launched target bundle identity changed for pid ${pid}`);
      }
      this.ownedTarget = Object.freeze({
        ...provisionalTarget,
        executable: launchedExecutable,
        provisional: false,
      });
      this.targetAttestation = Object.freeze({
        identity: Object.freeze({ ...postLaunchIdentity }),
        processKey: processInstanceKey(this.ownedTarget),
      });
      let selected;
      let readinessError;
      for (let attempt = 1; attempt <= this.targetReadyAttempts; attempt += 1) {
        try {
          const runningRecord = await this._registeredTargetRecords(bundleId, canonicalAppPath, {
            expectedRunningPid: pid,
          });
          if (runningRecord.running !== true || runningRecord.pid !== pid) {
            throw new Error(
              `CuaDriver list_apps did not resolve ${bundleId} to launched pid ${pid}`,
            );
          }
          await this._assertOwnedTargetProcess();
          const windows = await this._callStructured("list_windows", { pid });
          selected = selectCuaWindow(windows.windows, pid, {
            version: this.metadata.cli.version,
          });
          break;
        } catch (error) {
          readinessError = error;
          if (attempt < this.targetReadyAttempts) {
            await this.dependencies.sleep(this.targetReadyPollMs);
          }
        }
      }
      if (!selected) {
        throw new Error(
          `CuaDriver target did not become ready for pid ${pid}: ${actionErrorText(readinessError)}`,
        );
      }
      this.boundTarget = Object.freeze({
        appBundleId: bundleId,
        appPath: canonicalAppPath,
        birthMarker: provisionalTarget.birthMarker,
        digestSha256: preflightIdentity.digestSha256,
        executable: launchedExecutable,
        pid,
        startSec: provisionalTarget.startSec,
        startUsec: provisionalTarget.startUsec,
        windowId: selected.window.window_id,
        currentSpaceEvidence: selected.currentSpaceEvidence,
      });
      this.latestSnapshot = null;
      this.turnId = 0;
      return Object.freeze({
        pid,
        windowId: selected.window.window_id,
        currentSpaceEvidence: selected.currentSpaceEvidence,
      });
    } catch (error) {
      try {
        await this._cleanupOwnedTarget();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          `CuaDriver prepareTarget failed and owned target cleanup failed: ${actionErrorText(error)}; ${actionErrorText(cleanupError)}`,
        );
      }
      throw error;
    }
  }

  _requireBoundApp(app) {
    if (!this.boundTarget) throw new Error("CuaDriver target has not been prepared");
    if (app !== undefined && app !== this.boundTarget.appBundleId) {
      throw new Error(`CuaDriver action app mismatch: expected ${this.boundTarget.appBundleId}`);
    }
    return this.boundTarget;
  }

  async visibleState({ app } = {}) {
    const target = this._requireBoundApp(app);
    const turnId = this.turnId + 1;
    const maxEncodedImageBytes = 4 * Math.ceil(this.maxImageBytes / 3);
    const state = await this._callStructuredForTarget(
      target,
      "get_window_state",
      {
        pid: target.pid,
        window_id: target.windowId,
      },
      {
        maxOutputBytes: maxEncodedImageBytes + INLINE_SCREENSHOT_JSON_OVERHEAD_BYTES,
      },
    );
    if (state.pid !== target.pid || state.window_id !== target.windowId) {
      throw new Error("CuaDriver window state target identity mismatch");
    }
    if (
      Object.hasOwn(state, "screenshot_file_path") ||
      typeof state.screenshot_png_b64 !== "string"
    ) {
      throw new Error("CuaDriver get_window_state requires an inline PNG screenshot");
    }
    if (state.screenshot_mime_type !== "image/png") {
      throw new Error("CuaDriver screenshot_mime_type must be image/png");
    }
    const encodedScreenshot = state.screenshot_png_b64;
    if (
      encodedScreenshot.length === 0 ||
      encodedScreenshot.length > maxEncodedImageBytes ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encodedScreenshot)
    ) {
      throw new Error("CuaDriver screenshot_png_b64 must be bounded canonical base64");
    }
    const screenshotBytes = Buffer.from(encodedScreenshot, "base64");
    if (screenshotBytes.toString("base64") !== encodedScreenshot) {
      throw new Error("CuaDriver screenshot_png_b64 must be canonical base64");
    }
    if (screenshotBytes.length === 0 || screenshotBytes.length > this.maxImageBytes) {
      throw new Error(`CuaDriver decoded screenshot exceeds ${this.maxImageBytes} bytes`);
    }
    validatePngScreenshot(screenshotBytes);

    this.turnId = turnId;
    const snapshotId = `${target.pid}:${target.windowId}:${turnId}`;
    const elementTokens = new Map();
    for (const element of state.elements) {
      if (
        Number.isInteger(element?.element_index) &&
        typeof element?.element_token === "string" &&
        element.element_token !== ""
      ) {
        elementTokens.set(element.element_index, element.element_token);
      }
    }
    this.latestSnapshot = Object.freeze({
      pid: target.pid,
      windowId: target.windowId,
      snapshotId,
      elementTokens,
    });
    return normalizeVisibleState({
      text: normalizeElementsText(state.elements, state.tree_markdown),
      imageBase64: screenshotBytes.toString("base64"),
      target: {
        pid: target.pid,
        windowId: target.windowId,
        snapshotId,
      },
      metadata: {
        appBundleId: target.appBundleId,
        appPath: target.appPath,
        bundleDigestSha256: target.digestSha256,
        cuaSnapshotId: state.snapshot_id ?? "",
        currentSpaceEvidence: target.currentSpaceEvidence,
      },
    });
  }

  _validatedActionAddress(method, request) {
    const target = this._requireBoundApp(request?.app);
    if (!this.latestSnapshot) {
      throw new Error(`CuaDriver ${method} requires a visibleState snapshot`);
    }
    const validation = validateCuaElementIndexAddress(request?.elementAddress);
    if (!validation.ok) {
      throw new TypeError(`CuaDriver ${method} requires a valid cua-element-index address`);
    }
    const address = validation.normalized;
    if (
      address.pid !== target.pid ||
      address.windowId !== target.windowId ||
      address.snapshotId !== this.latestSnapshot.snapshotId
    ) {
      throw new Error(`stale CuaDriver element address for ${method}`);
    }
    if (
      request.elementIndex !== undefined &&
      String(request.elementIndex) !== String(address.elementIndex)
    ) {
      throw new Error(`CuaDriver ${method} element index does not match its address`);
    }
    return {
      address,
      elementToken: this.latestSnapshot.elementTokens.get(address.elementIndex) ?? "",
    };
  }

  async click(request = {}) {
    const { address, elementToken } = this._validatedActionAddress("click", request);
    const input = {
      pid: address.pid,
      window_id: address.windowId,
      element_index: address.elementIndex,
    };
    if (elementToken) input.element_token = elementToken;
    try {
      return normalizeCuaActionOutput(await this._callForTarget(this.boundTarget, "click", input), {
        tool: "click",
        input,
        version: this.metadata.cli.version,
      });
    } catch (error) {
      return normalizeActionResult({
        ok: false,
        text: actionErrorText(error),
        isError: true,
      });
    }
  }

  async setValue(request = {}) {
    if (typeof request.value !== "string") {
      throw new TypeError("CuaDriver setValue requires a string value");
    }
    const { address, elementToken } = this._validatedActionAddress("setValue", request);
    const input = {
      pid: address.pid,
      window_id: address.windowId,
      element_index: address.elementIndex,
    };
    if (elementToken) input.element_token = elementToken;
    input.value = request.value;
    try {
      return normalizeCuaActionOutput(
        await this._callForTarget(this.boundTarget, "set_value", input),
        {
          tool: "set_value",
          input,
          version: this.metadata.cli.version,
        },
      );
    } catch (error) {
      return normalizeActionResult({
        ok: false,
        text: actionErrorText(error),
        isError: true,
      });
    }
  }

  async close() {
    const failures = [];
    try {
      await this._cleanupOwnedTarget();
    } catch (error) {
      failures.push(error);
    }
    if (this.startedDaemon) {
      try {
        await this._cleanupOwnedDaemon();
      } catch (error) {
        failures.push(error);
      }
    }
    this.connected = false;
    if (!this.startedDaemon && this.attachMode) this.daemonPeer = null;
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        `CuaDriver cleanup failed: ${failures.map(actionErrorText).join("; ")}`,
      );
    }
  }
}
