import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { readFile, writeFile } from 'node:fs/promises';

function parseArgs(argv) {
  const options = {
    contextPath: '',
    dataDir: '',
    responseFiles: [],
    host: '127.0.0.1',
    pathnames: ['/v1/chat/completions', '/chat/completions'],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--context') {
      options.contextPath = next;
      index += 1;
    } else if (arg === '--data-dir') {
      options.dataDir = next;
      index += 1;
    } else if (arg === '--response-files') {
      options.responseFiles = next ? next.split(',').filter(Boolean) : [];
      index += 1;
    } else if (arg === '--host') {
      options.host = next || options.host;
      index += 1;
    } else if (arg === '--paths') {
      options.pathnames = next ? next.split(',').filter(Boolean) : options.pathnames;
      index += 1;
    }
  }

  if (!options.contextPath) {
    throw new Error('--context is required');
  }
  if (!options.dataDir) {
    options.dataDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../data');
  }

  return options;
}

function resolveResponseFile(filePath, dataDir) {
  return path.isAbsolute(filePath) ? filePath : path.join(dataDir, filePath);
}

function parseJsonl(content, filePath) {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Failed parsing JSONL response at ${filePath}:${index + 1}: ${error.message}`);
      }
    });
}

async function loadResponses(responseFiles, dataDir) {
  const responses = [];
  for (const file of responseFiles) {
    const resolved = resolveResponseFile(file, dataDir);
    responses.push(...parseJsonl(await readFile(resolved, 'utf8'), resolved));
  }
  return responses;
}

function writeJson(response, statusCode, body) {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(`${JSON.stringify(body)}\n`);
}

async function readBody(request, maxPreviewChars = 4000) {
  let raw = '';
  for await (const chunk of request) raw += chunk;
  return raw.length <= maxPreviewChars
    ? raw
    : `${raw.slice(0, maxPreviewChars)}...[truncated ${raw.length - maxPreviewChars} chars]`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  let responses = await loadResponses(options.responseFiles, options.dataDir);
  let requestIndex = 0;
  const allowedPaths = new Set(options.pathnames);

  const server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
      const pathname = requestUrl.pathname;

      if (request.method === 'GET' && pathname === '/health') {
        writeJson(response, 200, {
          status: 'ok',
          queuedResponses: responses.length,
          consumedResponses: requestIndex,
        });
        return;
      }

      if (request.method === 'POST' && pathname === '/__admin/mock-responses') {
        const rawBody = await readBody(request);
        let parsed = {};
        if (rawBody.trim()) {
          try {
            parsed = JSON.parse(rawBody);
          } catch (error) {
            writeJson(response, 400, { error: `Invalid JSON request body: ${error.message}` });
            return;
          }
        }

        if (Array.isArray(parsed.responses)) {
          responses = [...parsed.responses];
        } else if (Array.isArray(parsed.responseFiles)) {
          responses = await loadResponses(parsed.responseFiles, options.dataDir);
        } else {
          writeJson(response, 400, { error: 'Expected responses or responseFiles in request body' });
          return;
        }

        requestIndex = 0;
        writeJson(response, 200, { status: 'ok', queuedResponses: responses.length });
        return;
      }

      if (request.method !== 'POST' || !allowedPaths.has(pathname)) {
        writeJson(response, 404, { error: `Unhandled mock endpoint: ${request.method || 'UNKNOWN'} ${pathname}` });
        return;
      }

      const requestBodyPreview = await readBody(request);
      if (requestIndex >= responses.length) {
        writeJson(response, 500, {
          error: 'Mock response queue exhausted',
          code: 'MOCK_RESPONSE_QUEUE_EXHAUSTED',
          configuredResponses: responses.length,
          consumedResponses: requestIndex,
          requestedPath: pathname,
          requestBodyPreview,
        });
        return;
      }

      const payload = responses[requestIndex];
      requestIndex += 1;
      if (
        payload &&
        typeof payload === 'object' &&
        Object.prototype.hasOwnProperty.call(payload, '__mockStatus')
      ) {
        const statusCode = Number(payload.__mockStatus);
        writeJson(
          response,
          Number.isFinite(statusCode) ? statusCode : 500,
          payload.__mockBody || { error: 'Mock provider error' },
        );
        return;
      }

      writeJson(response, 200, payload);
    } catch (error) {
      writeJson(response, 500, { error: error.message || String(error) });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, options.host, resolve);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to determine mock server address');
  }

  const origin = `http://${options.host}:${address.port}`;
  await writeFile(
    options.contextPath,
    `${JSON.stringify({ origin, baseUrl: `${origin}/v1`, responseCount: responses.length }, null, 2)}\n`,
  );
  console.log(`[full-mac:mock-vllm] ${origin} with ${responses.length} queued responses`);

  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error) => {
  console.error(`[full-mac:mock-vllm] ${error.stack || error.message || String(error)}`);
  process.exit(1);
});
