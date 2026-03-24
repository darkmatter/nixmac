import {
  getLatestServerInstance,
  getSsmInstanceInfo,
  printRemoteInvocation,
  requireServerApp,
  runSsmCommands,
} from "./lib";

const [, , app, region = "us-west-2", linesArg = "120"] = process.argv;

if (!app) {
  throw new Error("usage: bun scripts/deploy/logs.ts <app> [region] [lines]");
}

requireServerApp(app);

const instance = getLatestServerInstance(region);
if (!instance) {
  console.log("No server instance found.");
  process.exit(0);
}

const lines = Number.parseInt(linesArg, 10);
if (!Number.isFinite(lines) || lines <= 0) {
  throw new Error(`invalid lines value: ${linesArg}`);
}

const ssm = getSsmInstanceInfo(instance.instanceId, region);

console.log(`App:          ${app}`);
console.log(`Region:       ${region}`);
if (instance.stage) {
  console.log(`Stage:        ${instance.stage}`);
}
console.log(`Instance ID:  ${instance.instanceId}`);
console.log(`State:        ${instance.state}`);

if (ssm?.PingStatus !== "Online") {
  console.log(`SSM Ping:     ${ssm?.PingStatus ?? "unknown"}`);
  console.log("SSM is not online; cannot fetch remote logs.");
  process.exit(0);
}

const invocation = runSsmCommands(instance.instanceId, region, "deploy-logs", [
  "set -eu",
  `echo '===== cloud-init-output.log (tail ${lines}) ====='`,
  `tail -n ${lines} /var/log/cloud-init-output.log || true`,
  "echo",
  `echo '===== nixmac-server journal (tail ${lines}) ====='`,
  `journalctl -u nixmac-server.service -n ${lines} --no-pager || true`,
], 1500, 18);

printRemoteInvocation(invocation);
