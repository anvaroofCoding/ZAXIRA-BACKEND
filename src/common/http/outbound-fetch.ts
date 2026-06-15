import * as https from 'node:https';
import * as http from 'node:http';

const TLS_ERROR_CODES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_HAS_EXPIRED',
]);

const insecureHttpsAgent = new https.Agent({ rejectUnauthorized: false });

function isTlsError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const cause = error.cause;
  if (cause && typeof cause === 'object' && 'code' in cause) {
    return TLS_ERROR_CODES.has(String((cause as { code?: string }).code));
  }

  return TLS_ERROR_CODES.has(error.message);
}

function shouldForceInsecureTls(): boolean {
  const flag = process.env.SERPAPI_TLS_INSECURE?.trim().toLowerCase();
  return flag === '1' || flag === 'true' || flag === 'yes';
}

type OutboundFetchInit = RequestInit & {
  timeoutMs?: number;
};

function requestBuffer(
  url: string,
  init: OutboundFetchInit,
  insecureTls: boolean,
): Promise<{ status: number; body: Buffer }> {
  const { timeoutMs = 25_000, headers } = init;
  const parsed = new URL(url);
  const isHttps = parsed.protocol === 'https:';
  const lib = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const req = lib.request(
      parsed,
      {
        method: init.method ?? 'GET',
        headers: {
          Accept: '*/*',
          ...(headers as Record<string, string> | undefined),
        },
        agent: isHttps && insecureTls ? insecureHttpsAgent : undefined,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks),
          });
        });
      },
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timeout after ${timeoutMs}ms`));
    });
    req.end();
  });
}

function requestText(
  url: string,
  init: OutboundFetchInit,
  insecureTls: boolean,
): Promise<{ status: number; body: string }> {
  const { timeoutMs = 25_000, headers } = init;
  const parsed = new URL(url);
  const isHttps = parsed.protocol === 'https:';
  const lib = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const req = lib.request(
      parsed,
      {
        method: init.method ?? 'GET',
        headers: {
          Accept: 'application/json',
          ...(headers as Record<string, string> | undefined),
        },
        agent: isHttps && insecureTls ? insecureHttpsAgent : undefined,
        timeout: timeoutMs,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timeout after ${timeoutMs}ms`));
    });
    req.end();
  });
}

function toResponse(result: { status: number; body: string }): Response {
  return new Response(result.body, {
    status: result.status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Tashqi HTTPS (SerpAPI va h.k.) — ba’zi Windows muhitlarida TLS zanjir xatosi bo‘ladi.
 */
export async function fetchBinaryWithTlsFallback(
  url: string,
  init: OutboundFetchInit = {},
): Promise<Buffer | null> {
  const { timeoutMs = 25_000, signal, ...requestInit } = init;

  if (shouldForceInsecureTls()) {
    const result = await requestBuffer(url, { ...requestInit, timeoutMs }, true);
    return result.status >= 200 && result.status < 300 && result.body.length > 0
      ? result.body
      : null;
  }

  try {
    const response = await fetch(url, {
      ...requestInit,
      signal: signal ?? AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      return null;
    }

    const bytes = await response.arrayBuffer();
    const buffer = Buffer.from(bytes);
    return buffer.length > 0 ? buffer : null;
  } catch (error) {
    if (!isTlsError(error)) {
      return null;
    }

    const result = await requestBuffer(url, { ...requestInit, timeoutMs }, true);
    return result.status >= 200 && result.status < 300 && result.body.length > 0
      ? result.body
      : null;
  }
}

export async function fetchWithTlsFallback(
  url: string,
  init: OutboundFetchInit = {},
): Promise<Response> {
  const { timeoutMs = 25_000, signal, ...requestInit } = init;

  if (shouldForceInsecureTls()) {
    const result = await requestText(url, { ...requestInit, timeoutMs }, true);
    return toResponse(result);
  }

  try {
    return await fetch(url, {
      ...requestInit,
      signal: signal ?? AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (!isTlsError(error)) {
      throw error;
    }

    const result = await requestText(url, { ...requestInit, timeoutMs }, true);
    return toResponse(result);
  }
}
