import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { fetchWithTlsFallback } from '../../common/http/outbound-fetch';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import {
  PurchaseRequestSessionDocumentsService,
  SessionDocumentType,
} from './purchase-request-session-documents.service';
import { signOnlyOfficeConfig } from './utils/onlyoffice-jwt.util';

interface OnlyOfficeCallbackBody {
  status: number;
  url?: string;
  key?: string;
  users?: string[];
}

@Injectable()
export class OnlyOfficeService {
  constructor(
    private readonly configService: ConfigService,
    private readonly sessionDocumentsService: PurchaseRequestSessionDocumentsService,
  ) {}

  isEnabled() {
    return Boolean(this.getDocumentServerUrl());
  }

  private getDocumentServerUrl() {
    return this.configService.get<string>('onlyoffice.url', '')?.replace(/\/$/, '');
  }

  private getJwtSecret() {
    return this.configService.get<string>('onlyoffice.jwtSecret', '');
  }

  private buildDocumentKey(sessionId: string, docType: SessionDocumentType, version: number) {
    return `${sessionId}-${docType}-${version}`;
  }

  async getEditorConfig(
    sessionId: string,
    docType: SessionDocumentType,
    documentToken: string,
    user: JwtPayload,
    documentVersion: number,
  ) {
    const documentServerUrl = this.getDocumentServerUrl();
    if (!documentServerUrl) {
      throw new ServiceUnavailableException(
        'ONLYOFFICE Document Server sozlanmagan (ONLYOFFICE_URL)',
      );
    }

    const apiPublicUrl = this.configService
      .get<string>('apiPublicUrl', 'http://localhost:8000/api')
      .replace(/\/$/, '');

    const fileUrl = this.sessionDocumentsService.buildDocumentDownloadUrl(
      sessionId,
      docType,
      documentToken,
    );

    const title =
      docType === 'bildirgi' ? 'Bildirgi.docx' : 'Kelishuv varaqasi.docx';

    const config: Record<string, unknown> = {
      documentType: 'word',
      document: {
        fileType: 'docx',
        key: this.buildDocumentKey(sessionId, docType, documentVersion),
        title,
        url: fileUrl,
        permissions: {
          edit: true,
          download: true,
          print: true,
          review: false,
        },
      },
      editorConfig: {
        mode: 'edit',
        lang: 'uz',
        callbackUrl: `${apiPublicUrl}/public/onlyoffice/callback?sessionId=${sessionId}&docType=${docType}&token=${encodeURIComponent(documentToken)}`,
        user: {
          id: user.sub,
          name: user.login,
        },
        customization: {
          autosave: true,
          forcesave: true,
          compactHeader: true,
        },
      },
      height: '100%',
      width: '100%',
    };

    const jwtSecret = this.getJwtSecret();
    if (jwtSecret) {
      return {
        documentServerUrl,
        config: {
          ...config,
          token: signOnlyOfficeConfig(config, jwtSecret),
        },
      };
    }

    return { documentServerUrl, config };
  }

  async handleCallback(
    sessionId: string,
    docType: SessionDocumentType,
    documentToken: string,
    body: OnlyOfficeCallbackBody,
  ) {
    if (!body || typeof body.status !== 'number') {
      throw new BadRequestException('ONLYOFFICE callback noto‘g‘ri');
    }

    // 2 — tayyor saqlash; 6 — majburiy saqlash
    if ((body.status === 2 || body.status === 6) && body.url) {
      const response = await fetchWithTlsFallback(body.url, { timeoutMs: 30000 });
      if (!response.ok) {
        throw new BadRequestException('ONLYOFFICE faylini yuklab bo‘lmadi');
      }

      const bytes = await response.arrayBuffer();
      const buffer = Buffer.from(bytes);
      if (!buffer.length) {
        throw new BadRequestException('ONLYOFFICE bo‘sh fayl qaytardi');
      }

      await this.sessionDocumentsService.saveDocument(sessionId, docType, buffer);
    }

    return { error: 0 };
  }
}
