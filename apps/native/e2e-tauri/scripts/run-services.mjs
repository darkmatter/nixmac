import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { constants as fsConstants } from 'node:fs';
import { fileURLToPath } from 'node:url';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(THIS_DIR, '../..');
const DIST_DIR = path.join(APP_DIR, 'dist');
const PORT = Number(process.env.NIXMAC_E2E_PORT ?? 5174);
const HOST = process.env.NIXMAC_E2E_HOST ?? '127.0.0.1';
const APP_DATA_DIR = process.env.NIXMAC_E2E_APP_DATA_DIR ?? '/tmp/nixmac-wdio-app-data';

const CONTENT_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.ttf', 'font/ttf'],
  ['.wasm', 'application/wasm'],
]);

async function assertDistExists() {
  try {
    await access(path.join(DIST_DIR, 'index.html'), fsConstants.R_OK);
  } catch {
    throw new Error(
      `Missing ${path.join(DIST_DIR, 'index.html')}. Run 'bun run build' before starting WDIO services.`,
    );
  }
}

function safeResolve(requestUrl) {
  const url = new URL(requestUrl ?? '/', `http://${HOST}:${PORT}`);
  const pathname = decodeURIComponent(url.pathname);
  const requested = pathname === '/' ? '/index.html' : pathname;
  const resolved = path.resolve(DIST_DIR, `.${requested}`);
  if (!resolved.startsWith(DIST_DIR)) {
    return null;
  }
  return resolved;
}

function startStaticServer() {
  const server = http.createServer((request, response) => {
    const filePath = safeResolve(request.url);
    if (!filePath) {
      response.writeHead(403);
      response.end('Forbidden');
      return;
    }

    const stream = createReadStream(filePath);
    stream.on('error', () => {
      response.writeHead(404);
      response.end('Not found');
    });
    stream.on('open', () => {
      response.writeHead(200, {
        'content-type': CONTENT_TYPES.get(path.extname(filePath)) ?? 'application/octet-stream',
      });
    });
    stream.pipe(response);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, HOST, () => resolve(server));
  });
}

function startTauriWd() {
  const child = spawn('tauri-wd', {
    env: {
      ...process.env,
      NIXMAC_DISABLE_UPDATER: '1',
      NIXMAC_E2E_APP_DATA_DIR: APP_DATA_DIR,
      NIXMAC_E2E_BYPASS_SINGLE_INSTANCE: '1',
      NIXMAC_SKIP_PERMISSIONS: '1',
    },
    stdio: 'inherit',
  });

  child.on('exit', (code, signal) => {
    if (code || signal) {
      console.error(`[wdio:services] tauri-wd exited (${code ?? signal})`);
      process.exitCode = code ?? 1;
    }
  });

  return child;
}

function shutdown(server, child) {
  child.kill('SIGINT');
  server.close();
}

await assertDistExists();
const server = await startStaticServer();
const child = startTauriWd();

console.log(`[wdio:services] serving ${DIST_DIR} at http://${HOST}:${PORT}`);
console.log(`[wdio:services] using ${APP_DATA_DIR} for isolated app data`);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    shutdown(server, child);
    process.exit(0);
  });
}
