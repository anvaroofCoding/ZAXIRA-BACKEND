import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  StreamableFile,
} from '@nestjs/common';
import { SkipTransform } from '../../common/decorators/skip-transform.decorator';
import { ParseMongoIdPipe } from '../../common/pipes/parse-mongo-id.pipe';
import { ApprovalDecision } from './enums/approval-decision.enum';
import { PurchaseRequestCommissionDocumentService } from './purchase-request-commission-document.service';
import { PurchaseRequestDocumentService } from './purchase-request-document.service';
import { PurchaseRequestsService } from './purchase-requests.service';

@Controller('public/purchase-requests')
export class PurchaseRequestPublicController {
  constructor(
    private readonly purchaseRequestsService: PurchaseRequestsService,
    private readonly documentService: PurchaseRequestDocumentService,
    private readonly commissionDocumentService: PurchaseRequestCommissionDocumentService,
  ) {}

  @Get(':id/pdf')
  @SkipTransform()
  async viewPdf(@Param('id', ParseMongoIdPipe) id: string) {
    const request = await this.purchaseRequestsService.findByIdOrFail(id);

    if (
      request.bossDecision !== ApprovalDecision.APPROVED ||
      !request.bossConfirmedAt
    ) {
      throw new ForbiddenException(
        'PDF faqat boshliq tasdiqlagandan keyin ochiladi',
      );
    }

    const buffer = await this.documentService.generatePdf(request);

    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `inline; filename="${this.documentService.buildFileName(request, 'pdf')}"`,
    });
  }

  @Get(':id/commission-pdf')
  @SkipTransform()
  async viewCommissionPdf(@Param('id', ParseMongoIdPipe) id: string) {
    const request = await this.purchaseRequestsService.findByIdOrFail(id);

    if (
      request.bossDecision !== ApprovalDecision.APPROVED ||
      !request.bossConfirmedAt
    ) {
      throw new ForbiddenException(
        'Kelishuv PDF faqat boshliq tasdiqlagandan keyin ochiladi',
      );
    }

    const buffer = await this.commissionDocumentService.generatePdf(request);

    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `inline; filename="${this.commissionDocumentService.buildFileName(request, 'pdf')}"`,
    });
  }
}
