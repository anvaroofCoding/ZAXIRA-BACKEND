import { ConfigService } from '@nestjs/config';

/** QR kodlar va ochiq havolalar uchun frontend domeni (APP_PUBLIC_URL). */
export function getAppPublicBaseUrl(configService: ConfigService): string {
  return configService
    .get<string>('appPublicUrl', 'http://localhost:5173')
    .replace(/\/$/, '');
}

export function buildPurchaseRequestVerifyPublicUrl(
  configService: ConfigService,
  token: string,
): string {
  const encodedToken = encodeURIComponent(token.trim());
  return `${getAppPublicBaseUrl(configService)}/public/ariza/tekshirish/${encodedToken}`;
}

export function buildPurchaseRequestBildirgiPdfPublicUrl(
  configService: ConfigService,
  requestId: string,
): string {
  return `${getAppPublicBaseUrl(configService)}/public/ariza/${requestId}/pdf`;
}

export function buildPurchaseRequestKelishuvPdfPublicUrl(
  configService: ConfigService,
  requestId: string,
): string {
  return `${getAppPublicBaseUrl(configService)}/public/ariza/${requestId}/kelishuv-pdf`;
}
