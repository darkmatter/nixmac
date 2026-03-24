import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export interface ServerInstanceSummary {
  instanceId: string;
  state: string;
  launchTime: string;
  publicDnsName?: string;
  publicIpAddress?: string;
  privateIpAddress?: string;
  stage?: string;
  source: "alchemy" | "aws";
}

export interface SsmInstanceInfo {
  PingStatus?: string;
  AgentVersion?: string;
  PlatformName?: string;
  PlatformVersion?: string;
  LastPingDateTime?: string;
}

export interface SsmInvocation {
  Status?: string;
  StatusDetails?: string;
  StandardOutputContent?: string;
  StandardErrorContent?: string;
}

const ROOT = process.cwd();
const ALCHEMY_APP_DIR = path.join(ROOT, ".alchemy", "nixmac-server");

export function requireServerApp(app: string) {
  if (app !== "server") {
    throw new Error(
      `deploy helper is currently only implemented for 'server', got: ${app}`,
    );
  }
}

export function getLatestServerInstance(region: string): ServerInstanceSummary | null {
  const alchemyState = getLatestAlchemyServerState();
  if (alchemyState) {
    return alchemyState;
  }

  const instances = awsJson<ServerInstanceSummary[]>(
    region,
    "ec2",
    "describe-instances",
    "--filters",
    "Name=tag:Name,Values=server",
    "Name=instance-state-name,Values=pending,running,stopping,stopped",
    "--query",
    "Reservations[].Instances[].{"
      + "instanceId:InstanceId,"
      + "state:State.Name,"
      + "launchTime:LaunchTime,"
      + "publicDnsName:PublicDnsName,"
      + "publicIpAddress:PublicIpAddress,"
      + "privateIpAddress:PrivateIpAddress"
      + "}",
  );

  if (!instances || instances.length === 0) {
    return null;
  }

  const latest = [...instances].sort((a, b) =>
    a.launchTime.localeCompare(b.launchTime),
  ).at(-1);

  return latest
    ? {
        ...latest,
        source: "aws",
      }
    : null;
}

export function getSsmInstanceInfo(
  instanceId: string,
  region: string,
): SsmInstanceInfo | null {
  const payload = awsJson<{ InstanceInformationList?: SsmInstanceInfo[] }>(
    region,
    "ssm",
    "describe-instance-information",
    "--filters",
    `Key=InstanceIds,Values=${instanceId}`,
  );
  return payload?.InstanceInformationList?.[0] ?? null;
}

export function runSsmCommands(
  instanceId: string,
  region: string,
  comment: string,
  commands: string[],
  waitMs = 1500,
  maxAttempts = 12,
): SsmInvocation {
  const commandId = awsText(
    region,
    "ssm",
    "send-command",
    "--instance-ids",
    instanceId,
    "--document-name",
    "AWS-RunShellScript",
    "--comment",
    comment,
    "--parameters",
    JSON.stringify({ commands }),
    "--query",
    "Command.CommandId",
  ).trim();

  let invocation: SsmInvocation = {};

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      Bun.sleepSync(waitMs);
    }

    invocation = awsJson<SsmInvocation>(
      region,
      "ssm",
      "get-command-invocation",
      "--command-id",
      commandId,
      "--instance-id",
      instanceId,
    );

    const status = invocation.Status ?? "";
    const details = invocation.StatusDetails ?? "";
    if (
      !["Pending", "InProgress", "Delayed"].includes(status)
      && !["Pending", "In Progress", "Delayed"].includes(details)
    ) {
      return invocation;
    }
  }

  return invocation;
}

export function printRemoteInvocation(invocation: SsmInvocation) {
  console.log(
    `SSM Cmd:      ${invocation.StatusDetails || invocation.Status || "unknown"}`,
  );

  const stdout = invocation.StandardOutputContent?.trim();
  const stderr = invocation.StandardErrorContent?.trim();

  if (stdout) {
    console.log("---- remote stdout ----");
    console.log(stdout);
  }

  if (stderr) {
    console.log("---- remote stderr ----");
    console.log(stderr);
  }
}

export function probeHealth(host?: string) {
  if (!host) {
    return {
      url: null,
      status: "missing-host",
      body: null,
      error: null,
    };
  }

  const url = `http://${host}/healthz`;
  try {
    const response = execFileSync("curl", [
      "-sS",
      "--max-time",
      "5",
      "-D",
      "-",
      url,
    ], { encoding: "utf8" });

    const [rawHeaders, ...rest] = response.split("\r\n\r\n");
    const body = rest.join("\r\n\r\n").trim() || null;
    const statusLine = rawHeaders.split("\r\n")[0] || "";
    const status = statusLine.split(" ").slice(1, 3).join(" ") || "ok";

    return { url, status, body, error: null };
  } catch (error: any) {
    return {
      url,
      status: "error",
      body: null,
      error:
        error?.stderr?.toString?.().trim()
        || error?.message
        || String(error),
    };
  }
}

function getLatestAlchemyServerState(): ServerInstanceSummary | null {
  if (!exists(ALCHEMY_APP_DIR)) {
    return null;
  }

  const stageDirs = readdirSync(ALCHEMY_APP_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  let latest: { stage: string; mtimeMs: number; file: string } | null = null;

  for (const stage of stageDirs) {
    const file = path.join(ALCHEMY_APP_DIR, stage, "server.json");
    if (!exists(file)) {
      continue;
    }
    const mtimeMs = statSync(file).mtimeMs;
    if (!latest || mtimeMs > latest.mtimeMs) {
      latest = { stage, mtimeMs, file };
    }
  }

  if (!latest) {
    return null;
  }

  const parsed = JSON.parse(readFileSync(latest.file, "utf8")) as {
    output?: {
      InstanceId?: string;
      State?: { Name?: string } | string;
      PublicDnsName?: string;
      PublicIp?: string;
      PrivateIp?: string;
    };
  };

  const output = parsed.output;
  if (!output?.InstanceId) {
    return null;
  }

  const state =
    typeof output.State === "string" ? output.State : output.State?.Name;

  return {
    instanceId: output.InstanceId,
    state: state ?? "unknown",
    launchTime: new Date(latest.mtimeMs).toISOString(),
    publicDnsName: output.PublicDnsName,
    publicIpAddress: output.PublicIp,
    privateIpAddress: output.PrivateIp,
    stage: latest.stage,
    source: "alchemy",
  };
}

function awsJson<T>(region: string, service: string, ...args: string[]): T {
  const result = execFileSync(
    "aws",
    [service, ...args, "--region", region, "--output", "json"],
    { encoding: "utf8" },
  );
  return JSON.parse(result) as T;
}

function awsText(region: string, service: string, ...args: string[]): string {
  return execFileSync(
    "aws",
    [service, ...args, "--region", region, "--output", "text"],
    { encoding: "utf8" },
  );
}

function exists(filePath: string) {
  try {
    statSync(filePath);
    return true;
  } catch {
    return false;
  }
}
