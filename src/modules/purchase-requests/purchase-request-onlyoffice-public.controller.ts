import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  StreamableFile,
  UnauthorizedException,
} from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { SkipTransform } from '../../common/decorators/skip-transform.decorator';
import { ParseMongoIdPipe } from '../../common/pipes/parse-mongo-id.pipe';
import { OnlyOfficeService } from './onlyoffice.service';
import { PurchaseRequestSessionDocumentsService } from './purchase-request-session-documents.service';
import { PurchaseRequestsService } from './purchase-requests.service';
import type { SessionDocumentType } from './purchase-request-session-documents.service';

@Controller('public')
export class PurchaseRequestOnlyOfficePublicController {
  constructor(
    private readonly purchaseRequestsService: PurchaseRequestsService,
    private readonly sessionDocumentsService: PurchaseRequestSessionDocumentsService,
    private readonly onlyOfficeService: OnlyOfficeService,
  ) {}

  @Get('purchase-request-sessions/:sessionId/documents/:docType')
  @SkipTransform()
  @Header(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  )
  async downloadSessionDocument(
    @Param('sessionId', ParseMongoIdPipe) sessionId: string,
    @Param('docType') docType: string,
    @Query('token') token: string | undefined,
  ) {
    if (!token?.trim()) {
      throw new UnauthorizedException('Hujjat tokeni talab qilinadi');
    }

    await this.purchaseRequestsService.assertSessionDocumentAccess(
      sessionId,
      token.trim(),
    );

    const normalizedType = this.normalizeDocType(docType);
    const filePath = this.sessionDocumentsService.resolveDocumentPath(
      sessionId,
      normalizedType,
    );

    return new StreamableFile(createReadStream(filePath), {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      disposition: `inline; filename="${normalizedType}.docx"`,
    });
  }

  @Post('onlyoffice/callback')
  @SkipTransform()
  async onlyOfficeCallback(
    @Query('sessionId') sessionId: string,
    @Query('docType') docType: string,
    @Query('token') token: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    if (!sessionId || !docType || !token?.trim()) {
      return { error: 1 };
    }

    await this.purchaseRequestsService.assertSessionDocumentAccess(
      sessionId,
      token.trim(),
    );

    const normalizedType = this.normalizeDocType(docType);
    const result = await this.onlyOfficeService.handleCallback(
      sessionId,
      normalizedType,
      token.trim(),
      body as never,
    );

    if (body?.status === 2 || body?.status === 6) {
      await this.purchaseRequestsService.bumpSessionDocumentVersion(
        sessionId,
        normalizedType,
      );
    }

    return result;
  }

  @Get('purchase-requests/verify/:token')
  @SkipTransform()
  async verifyApplicant(@Param('token') token: string) {
    return this.purchaseRequestsService.verifyApplicantByToken(token);
  }

  private normalizeDocType(value: string): SessionDocumentType {
    if (value === 'bildirgi' || value === 'kelishuv') {
      return value;
    }

    throw new UnauthorizedException('Noto‘g‘ri hujjat turi');
  }
}
