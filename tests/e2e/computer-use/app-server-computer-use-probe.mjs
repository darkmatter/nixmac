#!/usr/bin/env node

const url = process.argv[2] || "ws://127.0.0.1:18789";
const socket = new WebSocket(url);
const pending = new Map();
let nextId = 1;

function request(method, params = {}, timeoutMs = 60000) {
  const id = nextId++;
  socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out waiting for ${method}`));
    }, timeoutMs);
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
  });
}

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  const entry = pending.get(message.id);
  if (!entry) return;
  pending.delete(message.id);
  if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
  else entry.resolve(message);
});

await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Timed out connecting to ${url}`)), 10000);
  socket.addEventListener(
    "open",
    () => {
      clearTimeout(timer);
      resolve();
    },
    { once: true },
  );
  socket.addEventListener(
    "error",
    () => {
      clearTimeout(timer);
      reject(new Error(`WebSocket error connecting to ${url}`));
    },
    { once: true },
  );
});

try {
  await request("initialize", {
    clientInfo: { name: "nixmac-e2e-computer-use-preflight", version: "1.0.0" },
    capabilities: { experimentalApi: true },
  });
  const thread = await request("thread/start", {
    cwd: "/tmp",
    model: "gpt-5.4-mini",
    approvalPolicy: "never",
    sandbox: "danger-full-access",
    ephemeral: true,
  });
  const threadId = thread?.result?.thread?.id;
  if (!threadId) throw new Error("Codex app-server did not return a thread ID");

  const response = await request(
    "mcpServer/tool/call",
    {
      server: "computer-use",
      threadId,
      tool: "list_apps",
      arguments: {},
    },
    90000,
  );
  const text = response?.result?.content?.find((item) => item.type === "text")?.text || "";
  if (response?.result?.isError === true) {
    throw new Error(`Computer Use list_apps returned isError: ${text}`);
  }
  if (
    !text.includes(" — ") ||
    /Computer Use (?:server error|could not start)|not authenticated/i.test(text)
  ) {
    throw new Error(`Computer Use list_apps returned invalid app inventory: ${text}`);
  }
  const appCount = text.split("\n").filter((line) => line.includes(" — ")).length;
  if (appCount < 1) throw new Error("Computer Use list_apps returned an empty app inventory");

  console.log("computer_use_list_apps=ok");
  console.log(`computer_use_app_count=${appCount}`);
} finally {
  socket.close();
}
