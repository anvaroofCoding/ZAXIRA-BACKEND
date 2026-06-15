import { fetchBinaryWithTlsFallback } from '../http/outbound-fetch';

export async function buildQrPngBuffer(
  text: string,
  size = 240,
): Promise<Buffer | null> {
  const payload = text?.trim();
  if (!payload) {
    return null;
  }

  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=4&data=${encodeURIComponent(payload)}`;

  return fetchBinaryWithTlsFallback(qrUrl, { timeoutMs: 12000 });
}
