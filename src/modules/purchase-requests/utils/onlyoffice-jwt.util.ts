import { createHmac } from 'node:crypto';

function base64UrlEncode(value: string) {
  return Buffer.from(value).toString('base64url');
}

/** ONLYOFFICE Document Server JWT (HS256) */
export function signOnlyOfficeConfig(payload: Record<string, unknown>, secret: string) {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');

  return `${header}.${body}.${signature}`;
}
