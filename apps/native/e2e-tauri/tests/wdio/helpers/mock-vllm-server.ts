import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
// Always resolve fixture data from the source tree so compiled dist-e2e helpers
// can still load test data without copying fixtures into dist output.
const TEST_DATA_DIR = process.env['NIXMAC_WDIO_TEST_DATA_DIR']
  ?? path.resolve(THIS_DIR, '../../../../e2e-tauri/tests/data');

interface MockResponse {
  [key: string]: unknown;
}

export interface MockVllmServerContext {
  server: http.Server;
  baseUrl: string;
  origin: string;
  responseCount: number;
}

export interface MockVllmOptions {
  responseFiles?: string[];
  host?: string;
  pathnames?: string[];
  dataDir?: string;
}

function resolveMockResponseFilePath(filePath: string, dataDir: string): string {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.join(dataDir, filePath);
}

function parseMockResponseJsonl(content: string, filePath: string): MockResponse[] {
  const rawLines = content.split('\n');
  const responses: MockResponse[] = [];

  for (let i = 0; i < rawLines.length; i += 1) {
    const raw = rawLines[i];
    const line = raw.trim();

    if (!line || line.startsWith('//')) {
      continue;
    }

    try {
      responses.push(JSON.parse(line));
    } catch (error) {
      throw new Error(
        `[wdio:test-env] Failed parsing JSONL response at ${filePath}:${i + 1}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return responses;
}

async function loadMockResponses(responseFiles: string[], dataDir: string): Promise<MockResponse[]> {
  const files = Array.isArray(responseFiles) ? responseFiles : [];
  if (files.length === 0) {
    return [];
  }

  const responses: MockResponse[] = [];
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

function writeJsonResponse(response: http.ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(`${JSON.stringify(body)}\n`);
}

async function readRequestBody(request: http.IncomingMessage): Promise<string> {
  let rawBody = '';
  for await (const chunk of request) {
    rawBody += chunk;
  }

  if (rawBody.length <= 4000) {
    return rawBody;
  }

  return `${rawBody.slice(0, 4000)}…[truncated ${rawBody.length - 4000} chars]`;
}

export async function startMockVllmServer(mockVllmOptions: MockVllmOptions = {}): Promise<MockVllmServerContext> {
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

        let parsedBody: { responses?: MockResponse[]; responseFiles?: string[] } = {};
        if (rawBody.trim()) {
          try {
            parsedBody = JSON.parse(rawBody);
          } catch (err) {
            writeJsonResponse(response, 400, {
              error: `Invalid JSON in request body: ${err instanceof Error ? err.message : String(err)}`,
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

      writeJsonResponse(response, 200, payload);
    } catch (error) {
      writeJsonResponse(response, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
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

export async function stopMockVllmServer(serverContext: MockVllmServerContext | null | undefined): Promise<void> {
  if (!serverContext?.server) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
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
