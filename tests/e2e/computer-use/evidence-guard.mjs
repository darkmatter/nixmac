import { AsyncLocalStorage } from "node:async_hooks";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { constants as fsConstants } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

const CONTROL_TIMEOUT_MS = 30_000;
const CONTROL_POLL_MS = 10;
const OWNER_RECORD_VERSION = 2;
const OWNER_RECORD_MAX_BYTES = 16 * 1024;
const writerContext = new AsyncLocalStorage();
const execFile = promisify(execFileCallback);
let localHostIdentityPromise;
let localProcessBirthMarkerPromise;

const DARWIN_PROCESS_BIRTH_SCRIPT = String.raw`
import ctypes
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

pid = int(sys.argv[1])
info = ProcBsdInfo()
libproc = ctypes.CDLL("/usr/lib/libproc.dylib", use_errno=True)
read_bytes = libproc.proc_pidinfo(
    pid,
    3,
    0,
    ctypes.byref(info),
    ctypes.sizeof(info),
)
if read_bytes != ctypes.sizeof(info):
    sys.exit(3)
print(f"{info.pbi_start_tvsec}.{info.pbi_start_tvusec:06d}")
`;

const RECLAMATION_GATE_SCRIPT = String.raw`
import fcntl
import os
import sys

path = sys.argv[1]
fd = os.open(path, os.O_RDWR | os.O_NOFOLLOW)
try:
    fcntl.flock(fd, fcntl.LOCK_EX)
    os.write(sys.stdout.fileno(), b"locked\n")
    sys.stdin.buffer.read(1)
finally:
    os.close(fd)
`;

function validateRunDir(runDir) {
  if (typeof runDir !== "string" || !path.isAbsolute(runDir) || path.normalize(runDir) !== runDir) {
    throw new Error("evidence run directory must be an absolute normalized path");
  }
}

export function evidenceControlPaths(runDir) {
  validateRunDir(runDir);
  const controlDirectory = path.join(
    path.dirname(runDir),
    `.${path.basename(runDir)}.evidence-control`,
  );
  return Object.freeze({
    controlDirectory,
    activeWritersDirectory: path.join(controlDirectory, "active-writers"),
    staleOwnersDirectory: path.join(controlDirectory, "stale-owners"),
    reclamationGatePath: path.join(controlDirectory, "reclamation.gate"),
    admissionLockPath: path.join(controlDirectory, "admission.lock"),
    admissionClosedPath: path.join(controlDirectory, "admission.closed"),
    sealerLockPath: path.join(controlDirectory, "sealer.lock"),
  });
}

async function directDirectory(filePath, label) {
  const stats = await lstat(filePath);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a direct directory: ${filePath}`);
  }
}

async function ensureDirectDirectory(filePath, label) {
  await mkdir(filePath, { mode: 0o700 }).catch((error) => {
    if (error?.code !== "EEXIST") throw error;
  });
  await directDirectory(filePath, label);
}

async function ensureControlDirectories(runDir) {
  const paths = evidenceControlPaths(runDir);
  await mkdir(paths.controlDirectory, { recursive: true, mode: 0o700 });
  await directDirectory(paths.controlDirectory, "evidence control directory");
  await ensureDirectDirectory(paths.activeWritersDirectory, "active-writers registry");
  await ensureDirectDirectory(paths.staleOwnersDirectory, "stale-owner quarantine");
  return paths;
}

async function pathExists(filePath) {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function linuxBootMarker() {
  return (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim();
}

async function darwinBootMarker() {
  const { stdout } = await execFile("/usr/sbin/sysctl", ["-n", "kern.boottime"], {
    encoding: "utf8",
    timeout: 2_000,
  });
  const marker = stdout.trim();
  if (!marker) throw new Error("empty Darwin boot marker");
  return marker;
}

async function loadCurrentHostIdentity() {
  const hostname = os.hostname();
  let bootMarker;
  if (process.platform === "linux") {
    bootMarker = await linuxBootMarker();
  } else if (process.platform === "darwin") {
    bootMarker = await darwinBootMarker();
  } else {
    throw new Error(`unsupported platform for process-owner identity: ${process.platform}`);
  }
  if (!hostname || !bootMarker) throw new Error("incomplete local host identity");
  return Object.freeze({ hostname, bootMarker });
}

function currentHostIdentity() {
  localHostIdentityPromise ||= loadCurrentHostIdentity();
  return localHostIdentityPromise;
}

async function linuxProcessBirthMarker(pid) {
  let raw;
  try {
    raw = await readFile(`/proc/${pid}/stat`, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  const commandEnd = raw.lastIndexOf(")");
  if (commandEnd < 0) throw new Error(`cannot parse process identity for PID ${pid}`);
  const fields = raw
    .slice(commandEnd + 2)
    .trim()
    .split(/\s+/);
  const startTicks = fields[19];
  if (!/^\d+$/.test(startTicks ?? "")) {
    throw new Error(`cannot parse process birth marker for PID ${pid}`);
  }
  return `linux-start-ticks:${startTicks}`;
}

async function darwinProcessBirthMarker(pid) {
  try {
    const { stdout } = await execFile(
      "/usr/bin/python3",
      ["-c", DARWIN_PROCESS_BIRTH_SCRIPT, String(pid)],
      {
        encoding: "utf8",
        timeout: 2_000,
      },
    );
    const marker = stdout.trim();
    if (!/^\d+\.\d{6}$/.test(marker)) {
      throw new Error(`invalid Darwin process birth marker for PID ${pid}`);
    }
    return `darwin-start-time:${marker}`;
  } catch (error) {
    if (error?.code === 3) return null;
    throw error;
  }
}

async function processBirthMarker(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error(`invalid owner PID: ${pid}`);
  }
  if (process.platform === "linux") return linuxProcessBirthMarker(pid);
  if (process.platform === "darwin") return darwinProcessBirthMarker(pid);
  throw new Error(`unsupported platform for process birth marker: ${process.platform}`);
}

async function createOwnerRecord(kind) {
  const host = await currentHostIdentity();
  localProcessBirthMarkerPromise ||= processBirthMarker(process.pid);
  const birthMarker = await localProcessBirthMarkerPromise;
  if (birthMarker === null) throw new Error("cannot identify the current owner process");
  return Object.freeze({
    version: OWNER_RECORD_VERSION,
    kind,
    pid: process.pid,
    processBirthMarker: birthMarker,
    hostname: host.hostname,
    bootMarker: host.bootMarker,
    nonce: randomUUID(),
    createdAt: new Date().toISOString(),
  });
}

function validateOwnerRecord(record, expectedKind, ownerPath) {
  if (
    record === null ||
    typeof record !== "object" ||
    Array.isArray(record) ||
    record.version !== OWNER_RECORD_VERSION ||
    record.kind !== expectedKind ||
    !Number.isSafeInteger(record.pid) ||
    record.pid <= 0 ||
    typeof record.processBirthMarker !== "string" ||
    record.processBirthMarker.length < 8 ||
    typeof record.hostname !== "string" ||
    record.hostname.length === 0 ||
    typeof record.bootMarker !== "string" ||
    record.bootMarker.length === 0 ||
    typeof record.nonce !== "string" ||
    !/^[0-9a-f-]{36}$/.test(record.nonce) ||
    typeof record.createdAt !== "string" ||
    Number.isNaN(Date.parse(record.createdAt))
  ) {
    throw new Error(`unverifiable ${expectedKind} owner record; refusing recovery: ${ownerPath}`);
  }
  return record;
}

async function writeSyncedFile(filePath, contents) {
  const handle = await open(
    filePath,
    fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function fsyncDirectory(directory) {
  const handle = await open(directory, fsConstants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function publishOwnerRecord(ownerPath, record, fixedPath) {
  const directory = path.dirname(ownerPath);
  const temporaryPath = path.join(directory, `.owner-${process.pid}-${record.nonce}.tmp`);
  await writeSyncedFile(temporaryPath, `${JSON.stringify(record)}\n`);
  try {
    if (fixedPath) {
      await link(temporaryPath, ownerPath);
      await unlink(temporaryPath);
    } else {
      await rename(temporaryPath, ownerPath);
    }
    await fsyncDirectory(directory);
  } catch (error) {
    await unlink(temporaryPath).catch((cleanupError) => {
      if (cleanupError?.code !== "ENOENT") throw cleanupError;
    });
    throw error;
  }
}

async function ensureReclamationGate(paths) {
  const gateContents = '{"version":1,"purpose":"serialize-stale-owner-reclamation"}\n';
  const temporaryPath = path.join(
    paths.controlDirectory,
    `.reclamation-gate-${process.pid}-${randomUUID()}.tmp`,
  );
  await writeSyncedFile(temporaryPath, gateContents);
  try {
    await link(temporaryPath, paths.reclamationGatePath);
    await fsyncDirectory(paths.controlDirectory);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  } finally {
    await unlink(temporaryPath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
  const handle = await open(paths.reclamationGatePath, fsConstants.O_RDWR | fsConstants.O_NOFOLLOW);
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1) {
      throw new Error("evidence reclamation gate must be one direct regular file");
    }
    if ((await handle.readFile("utf8")) !== gateContents) {
      throw new Error("evidence reclamation gate contents are invalid");
    }
  } finally {
    await handle.close();
  }
}

async function acquireReclamationGate(paths) {
  await ensureReclamationGate(paths);
  const child = spawn(
    "/usr/bin/python3",
    ["-c", RECLAMATION_GATE_SCRIPT, paths.reclamationGatePath],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const exit = once(child, "exit");
  await new Promise((resolve, reject) => {
    let stdout = "";
    const onData = (chunk) => {
      stdout += chunk;
      if (stdout === "locked\n") {
        child.stdout.off("data", onData);
        resolve();
      } else if (!"locked\n".startsWith(stdout)) {
        reject(new Error(`invalid reclamation gate handshake: ${JSON.stringify(stdout)}`));
      }
    };
    child.stdout.on("data", onData);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      reject(
        new Error(
          `reclamation gate helper exited before locking (${code ?? signal}): ${stderr.trim()}`,
        ),
      );
    });
  });
  return async () => {
    child.stdin.end("x");
    const [code, signal] = await exit;
    if (code !== 0) {
      throw new Error(
        `reclamation gate helper failed during release (${code ?? signal}): ${stderr.trim()}`,
      );
    }
  };
}

async function withReclamationGate(paths, action) {
  const release = await acquireReclamationGate(paths);
  try {
    return await action();
  } finally {
    await release();
  }
}

async function readOwnerRecord(ownerPath, expectedKind) {
  let handle;
  try {
    handle = await open(ownerPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error(`cannot inspect ${expectedKind} owner record ${ownerPath}: ${error.message}`);
  }
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size <= 0 || before.size > OWNER_RECORD_MAX_BYTES) {
      throw new Error(`unverifiable ${expectedKind} owner record; refusing recovery: ${ownerPath}`);
    }
    const raw = await handle.readFile("utf8");
    const after = await handle.stat();
    const pathStats = await lstat(ownerPath);
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.dev !== pathStats.dev ||
      before.ino !== pathStats.ino ||
      pathStats.isSymbolicLink()
    ) {
      throw new Error(`unstable ${expectedKind} owner record; refusing recovery: ${ownerPath}`);
    }
    let record;
    try {
      record = JSON.parse(raw);
    } catch {
      throw new Error(`unverifiable ${expectedKind} owner record; refusing recovery: ${ownerPath}`);
    }
    return validateOwnerRecord(record, expectedKind, ownerPath);
  } finally {
    await handle.close();
  }
}

async function classifyOwner(record) {
  const host = await currentHostIdentity();
  if (record.hostname !== host.hostname) {
    return { status: "unverifiable", reason: "owner-host-mismatch" };
  }
  if (record.bootMarker !== host.bootMarker) {
    return { status: "stale", reason: "owner-host-rebooted" };
  }
  try {
    process.kill(record.pid, 0);
  } catch (error) {
    if (error?.code === "ESRCH") return { status: "stale", reason: "owner-process-dead" };
    if (error?.code !== "EPERM") {
      return { status: "unverifiable", reason: `owner-liveness-${error?.code ?? "error"}` };
    }
  }
  try {
    const observedBirthMarker = await processBirthMarker(record.pid);
    if (observedBirthMarker === null) {
      return { status: "stale", reason: "owner-process-dead" };
    }
    if (observedBirthMarker !== record.processBirthMarker) {
      return { status: "stale", reason: "owner-pid-reused", observedBirthMarker };
    }
    return { status: "live", reason: "owner-process-live" };
  } catch (error) {
    return {
      status: "unverifiable",
      reason: `owner-birth-marker-unverifiable:${error.message}`,
    };
  }
}

async function quarantineStaleOwner(paths, ownerPath, record, classification) {
  const reasonSlug = classification.reason.replace(/[^a-z0-9-]/gi, "-");
  const quarantineName = `${path.basename(ownerPath)}.${reasonSlug}.${Date.now()}.${randomUUID()}.stale`;
  const quarantinePath = path.join(paths.staleOwnersDirectory, quarantineName);
  try {
    await rename(ownerPath, quarantinePath);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  await fsyncDirectory(path.dirname(ownerPath));
  await fsyncDirectory(paths.staleOwnersDirectory);
  const audit = {
    version: 1,
    action: "quarantined-stale-evidence-owner",
    reason: classification.reason,
    reclaimedAt: new Date().toISOString(),
    reclaimedBy: await createOwnerRecord("reclaimer"),
    owner: record,
    originalPath: ownerPath,
    quarantinePath,
  };
  const auditPath = `${quarantinePath}.audit.json`;
  const temporaryAuditPath = `${auditPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeSyncedFile(temporaryAuditPath, `${JSON.stringify(audit, null, 2)}\n`);
  await rename(temporaryAuditPath, auditPath);
  await fsyncDirectory(paths.staleOwnersDirectory);
  return true;
}

async function pauseAtDeterministicReclaimBarrier(record) {
  const barrierDirectory = process.env.NIXMAC_E2E_TEST_RECLAIM_BARRIER_DIR || "";
  if (!barrierDirectory) return;
  if (!path.isAbsolute(barrierDirectory) || path.normalize(barrierDirectory) !== barrierDirectory) {
    throw new Error("test reclaim barrier directory must be absolute and normalized");
  }
  const markerPath = path.join(barrierDirectory, `${process.pid}-${record.nonce}.classified`);
  await writeFile(markerPath, "classified\n", { encoding: "utf8", flag: "wx", mode: 0o600 });
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    const markers = (await readdir(barrierDirectory)).filter((entry) =>
      entry.endsWith(".classified"),
    );
    if (markers.length >= 2) break;
    await delay(CONTROL_POLL_MS);
  }
  const postBarrierDelay = Number(process.env.NIXMAC_E2E_TEST_RECLAIM_POST_BARRIER_DELAY_MS || 0);
  if (!Number.isSafeInteger(postBarrierDelay) || postBarrierDelay < 0 || postBarrierDelay > 2_000) {
    throw new Error("test reclaim post-barrier delay must be 0-2000 milliseconds");
  }
  if (postBarrierDelay > 0) await delay(postBarrierDelay);
}

async function inspectAndMaybeReclaimLocked(paths, ownerPath, expectedKind) {
  const record = await readOwnerRecord(ownerPath, expectedKind);
  if (record === null) return { status: "gone" };
  if (
    expectedKind === "writer" &&
    path.basename(ownerPath) !== `${record.pid}-${record.nonce}.json`
  ) {
    throw new Error(`writer registration path does not match its owner identity: ${ownerPath}`);
  }
  const classification = await classifyOwner(record);
  if (classification.status === "stale") {
    await pauseAtDeterministicReclaimBarrier(record);
    const reclaimed = await quarantineStaleOwner(paths, ownerPath, record, classification);
    return { status: reclaimed ? "reclaimed" : "gone", reason: classification.reason };
  }
  if (classification.status === "unverifiable") {
    throw new Error(
      `cannot verify ${expectedKind} owner; refusing stale-owner recovery (${classification.reason}): ${ownerPath}`,
    );
  }
  return classification;
}

async function inspectAndMaybeReclaim(paths, ownerPath, expectedKind) {
  return withReclamationGate(paths, () =>
    inspectAndMaybeReclaimLocked(paths, ownerPath, expectedKind),
  );
}

async function releaseOwnedPath(ownerPath, expectedKind, nonce) {
  const record = await readOwnerRecord(ownerPath, expectedKind);
  if (record === null) {
    throw new Error(`${expectedKind} owner record disappeared before release: ${ownerPath}`);
  }
  if (record.pid !== process.pid || record.nonce !== nonce) {
    throw new Error(`${expectedKind} owner changed before release: ${ownerPath}`);
  }
  await unlink(ownerPath);
  await fsyncDirectory(path.dirname(ownerPath));
}

async function acquireOwnerLock(paths, lockPath, kind, label) {
  const deadline = Date.now() + CONTROL_TIMEOUT_MS;
  const record = await createOwnerRecord(kind);
  for (;;) {
    try {
      await publishOwnerRecord(lockPath, record, true);
      return async () => releaseOwnedPath(lockPath, kind, record.nonce);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const state = await inspectAndMaybeReclaim(paths, lockPath, kind);
      if (state.status === "reclaimed" || state.status === "gone") continue;
      if (Date.now() >= deadline) {
        throw new Error(`timed out waiting for ${label}: ${lockPath}`);
      }
      await delay(CONTROL_POLL_MS);
    }
  }
}

async function assertWriterAdmissionOpen(runDir, paths = evidenceControlPaths(runDir)) {
  if (
    (await pathExists(paths.admissionClosedPath)) ||
    (await pathExists(path.join(runDir, "manifest.json")))
  ) {
    throw new Error("evidence writer admission is closed; verified evidence is immutable");
  }
}

async function registerWriter(runDir) {
  const paths = await ensureControlDirectories(runDir);
  const releaseAdmissionLock = await acquireOwnerLock(
    paths,
    paths.admissionLockPath,
    "admission-lock",
    "evidence admission lock",
  );
  const record = await createOwnerRecord("writer");
  const registrationPath = path.join(
    paths.activeWritersDirectory,
    `${record.pid}-${record.nonce}.json`,
  );
  try {
    await assertWriterAdmissionOpen(runDir, paths);
    await publishOwnerRecord(registrationPath, record, false);
  } finally {
    await releaseAdmissionLock();
  }
  return async () => releaseOwnedPath(registrationPath, "writer", record.nonce);
}

export async function assertEvidenceTreeMutable(runDir) {
  validateRunDir(runDir);
  const paths = await ensureControlDirectories(runDir);
  await assertWriterAdmissionOpen(runDir, paths);
}

export async function withEvidenceTreeMutation(runDir, mutate) {
  if (typeof mutate !== "function") throw new TypeError("evidence mutation must be a function");
  validateRunDir(runDir);
  const inheritedRegistration = writerContext.getStore();
  if (inheritedRegistration?.runDir === runDir && inheritedRegistration.active === true) {
    return mutate();
  }
  const unregister = await registerWriter(runDir);
  const registration = { active: true, runDir };
  try {
    return await writerContext.run(registration, mutate);
  } finally {
    registration.active = false;
    await unregister();
  }
}

async function closeWriterAdmission(runDir) {
  const paths = await ensureControlDirectories(runDir);
  const releaseAdmissionLock = await acquireOwnerLock(
    paths,
    paths.admissionLockPath,
    "admission-lock",
    "evidence admission lock",
  );
  try {
    if (!(await pathExists(paths.admissionClosedPath))) {
      await writeFile(
        paths.admissionClosedPath,
        `${JSON.stringify({
          version: 2,
          closedAt: new Date().toISOString(),
          closedBy: await createOwnerRecord("admission-closer"),
        })}\n`,
        { encoding: "utf8", flag: "wx", mode: 0o600 },
      );
    }
  } finally {
    await releaseAdmissionLock();
  }
  return paths;
}

async function drainActiveWriters(paths) {
  const deadline = Date.now() + CONTROL_TIMEOUT_MS;
  for (;;) {
    const activeWriters = await readdir(paths.activeWritersDirectory);
    if (activeWriters.length === 0) return;
    let sawLiveOwner = false;
    for (const entry of activeWriters.sort()) {
      if (!/^\d+-[0-9a-f-]{36}\.json$/.test(entry)) {
        throw new Error(
          `unverifiable entry in active-writers registry; refusing recovery: ${entry}`,
        );
      }
      const state = await inspectAndMaybeReclaim(
        paths,
        path.join(paths.activeWritersDirectory, entry),
        "writer",
      );
      if (state.status === "live") sawLiveOwner = true;
    }
    if (!sawLiveOwner) continue;
    if (Date.now() >= deadline) {
      throw new Error(
        `timed out draining registered evidence writers: ${activeWriters.join(", ")}`,
      );
    }
    await delay(CONTROL_POLL_MS);
  }
}

export async function withEvidenceTreeSeal(runDir, seal) {
  if (typeof seal !== "function") throw new TypeError("evidence seal must be a function");
  validateRunDir(runDir);
  const inheritedRegistration = writerContext.getStore();
  if (inheritedRegistration?.runDir === runDir && inheritedRegistration.active === true) {
    throw new Error("an admitted evidence writer cannot seal its own active evidence tree");
  }
  const paths = await closeWriterAdmission(runDir);
  const releaseSealerLock = await acquireOwnerLock(
    paths,
    paths.sealerLockPath,
    "sealer-lock",
    "evidence sealer lock",
  );
  try {
    await drainActiveWriters(paths);
    return await seal();
  } finally {
    await releaseSealerLock();
  }
}
