import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const TEST_DATA_DIR = path.resolve(THIS_DIR, '../../data');

function resolveMockResponseFilePath(filePath, dataDir) {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }

  return path.join(dataDir, filePath);
}

function parseMockResponseJsonl(content, filePath) {
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(
        `[wdio:test-env] Failed parsing JSONL response at ${filePath}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}

async function loadMockResponses(responseFiles, dataDir) {
  const files = Array.isArray(responseFiles) ? responseFiles : [];
  if (files.length === 0) {
    return [];
  }

  const responses = [];
  for (const file of files) {
    const resolvedPath = resolveMockResponseFilePath(file, dataDir);
    const raw = await readFile(resolvedPath, 'utf-8');
    const fileResponses = parseMockResponseJsonl(raw, resolvedPath);
    responses.push(...fileResponses);
  }

  if (responses.length === 0) {
    throw new Error('[wdio:test-env] mockVllm fixture files were loaded but produced zero responses');
  }

  return responses;
}

function writeJsonResponse(response, statusCode, body) {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(`${JSON.stringify(body)}\n`);
}

async function readRequestBody(request, { maxPreviewChars = 4000 } = {}) {
  let rawBody = '';
  for await (const chunk of request) {
    rawBody += chunk;
  }

  if (rawBody.length <= maxPreviewChars) {
    return rawBody;
  }

  return `${rawBody.slice(0, maxPreviewChars)}…[truncated ${rawBody.length - maxPreviewChars} chars]`;
}

export async function startMockVllmServer(mockVllmOptions = {}) {
  const {
    responseFiles = [],
    host = '127.0.0.1',
    pathnames = ['/v1/chat/completions', '/chat/completions'],
    dataDir = TEST_DATA_DIR,
  } = mockVllmOptions;

  let responses = await loadMockResponses(responseFiles, dataDir);
  const allowedPaths = new Set(pathnames);
  let requestIndex = 0;

  const server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
      const pathname = requestUrl.pathname;

      if (request.method === 'GET' && pathname === '/health') {
        writeJsonResponse(response, 200, { status: 'ok' });
        return;
      }

      if (request.method === 'POST' && pathname === '/__admin/mock-responses') {
        const rawBody = await readRequestBody(request);

        let parsedBody = {};
        if (rawBody.trim()) {
          try {
            parsedBody = JSON.parse(rawBody);
          } catch (err) {
            writeJsonResponse(response, 400, {
              error: `Invalid JSON in request body: ${err.message}`,
            });
            return;
          }
        }

        if (Array.isArray(parsedBody.responses)) {
          responses = [...parsedBody.responses];
        } else if (Array.isArray(parsedBody.responseFiles)) {
          responses = await loadMockResponses(parsedBody.responseFiles, dataDir);
        } else {
          writeJsonResponse(response, 400, {
            error: 'Expected "responses" or "responseFiles" in request body',
          });
          return;
        }

        requestIndex = 0;
        writeJsonResponse(response, 200, {
          status: 'ok',
          queuedResponses: responses.length,
        });
        return;
      }

      if (request.method !== 'POST' || !allowedPaths.has(pathname)) {
        writeJsonResponse(response, 404, {
          error: `Unhandled mock endpoint: ${request.method ?? 'UNKNOWN'} ${pathname}`,
        });
        return;
      }

      // Consume request body once so we can log/inspect it on failures.
      const requestBodyPreview = await readRequestBody(request);

      if (requestIndex >= responses.length) {
        console.error('[wdio:test-env] Mock response queue exhausted', {
          method: request.method,
          path: pathname,
          configuredResponses: responses.length,
          consumedResponses: requestIndex,
          requestBodyPreview,
        });

        writeJsonResponse(response, 500, {
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
        writeJsonResponse(
          response,
          Number.isFinite(statusCode) ? statusCode : 500,
          payload.__mockBody ?? { error: 'Mock provider error' },
        );
        return;
      }

      writeJsonResponse(response, 200, payload);
    } catch (error) {
      writeJsonResponse(response, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, resolve);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('[wdio:test-env] Failed to determine mock vLLM server address');
  }

  const origin = `http://${host}:${address.port}`;
  console.log(
    `[wdio:test-env] Started mock vLLM server at ${origin} with ${responses.length} queued responses`,
  );

  return {
    server,
    baseUrl: `${origin}/v1`,
    origin,
    responseCount: responses.length,
  };
}

export async function stopMockVllmServer(serverContext) {
  if (!serverContext?.server) {
    return;
  }

  await new Promise((resolve, reject) => {
    serverContext.server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  console.log(`[wdio:test-env] Stopped mock vLLM server at ${serverContext.origin}`);
}
