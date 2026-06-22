import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  StreamableFile,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
  forwardRef,
} from '@nestjs/common';
import {
  FileFieldsInterceptor,
  FileInterceptor,
  FilesInterceptor,
} from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Request } from 'express';
import { createReadStream } from 'fs';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SkipTransform } from '../../common/decorators/skip-transform.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ParseMongoIdPipe } from '../../common/pipes/parse-mongo-id.pipe';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { PurchaseRequestStatus } from './enums/purchase-request-status.enum';
import { HistoryStepType } from './schemas/history-step.schema';
import { ConfirmBossDecisionDto } from './dto/confirm-boss-decision.dto';
import { CreatePurchaseRequestDto } from './dto/create-purchase-request.dto';
import { QueryApprovalInboxDto } from './dto/query-approval-inbox.dto';
import { QueryPurchaseRequestHistoryDto } from './dto/query-purchase-request-history.dto';
import { QueryPurchaseStatisticsDto } from './dto/query-purchase-statistics.dto';
import { QueryPurchaseRequestsDto } from './dto/query-purchase-requests.dto';
import { QueryPurchasingInboxDto } from './dto/query-purchasing-inbox.dto';
import { PolishPurchaseItemTextDto } from './dto/polish-purchase-item-text.dto';
import { CompletePurchaseInput } from './types/complete-purchase-input.type';
import { ResubmitPurchaseRequestDto } from './dto/resubmit-purchase-request.dto';
import { MarkItemsUnavailableDto } from './dto/mark-items-unavailable.dto';
import { RejectPurchaseDto } from './dto/reject-purchase.dto';
import { UpdatePurchaseBatchContractDto } from './dto/update-purchase-batch-contract.dto';
import { UpdatePurchaseContractBodyDto } from './dto/update-purchase-contract-body.dto';
import { UpdatePurchaseRequestDto } from './dto/update-purchase-request.dto';
import { SubmitApprovalDecisionDto } from './dto/submit-approval-decision.dto';
import { OnlyOfficeService } from './onlyoffice.service';
import { PurchaseRequestCommissionDocumentService } from './purchase-request-commission-document.service';
import { PurchaseRequestDocumentService } from './purchase-request-document.service';
import { PurchaseRequestsService } from './purchase-requests.service';
import type { SessionDocumentType } from './purchase-request-session-documents.service';
import { WarehouseDispatchesService } from '../warehouse-dispatches/warehouse-dispatches.service';
import { WarehouseDispatchDocument } from '../warehouse-dispatches/schemas/warehouse-dispatch.schema';

@Controller('purchase-requests')
@UseGuards(JwtAuthGuard)
export class PurchaseRequestsController {
  constructor(
    private readonly purchaseRequestsService: PurchaseRequestsService,
    private readonly documentService: PurchaseRequestDocumentService,
    private readonly commissionDocumentService: PurchaseRequestCommissionDocumentService,
    private readonly onlyOfficeService: OnlyOfficeService,
    @Inject(forwardRef(() => WarehouseDispatchesService))
    private readonly warehouseDispatchesService: WarehouseDispatchesService,
  ) {}

  private mapDispatchMeta(
    dispatch: WarehouseDispatchDocument,
    includeReceipt = false,
  ) {
    return {
      id: dispatch.id,
      dispatchCode: dispatch.dispatchCode,
      status: dispatch.status,
      purchaseBatchId: dispatch.purchaseBatchId,
      targetStructure: { shortName: dispatch.targetStructure.shortName },
      ...(includeReceipt
        ? { receipt: this.warehouseDispatchesService.mapReceiptPublic(dispatch) }
        : {}),
    };
  }

  private async buildDispatchMetaLoader(ids: string[]) {
    const grouped =
      await this.warehouseDispatchesService.findGroupedMapByPurchaseRequestIds(
        ids,
      );

    const result = new Map<
      string,
      Parameters<PurchaseRequestsService['buildWarehouseMetaFromDispatch']>[1]
    >();

    for (const [requestId, dispatches] of grouped.entries()) {
      result.set(
        requestId,
        dispatches.map((dispatch) => this.mapDispatchMeta(dispatch)),
      );
    }

    return result;
  }

  private async buildPurchasedDispatchDetailLoader(ids: string[]) {
    const grouped =
      await this.warehouseDispatchesService.findGroupedMapByPurchaseRequestIds(
        ids,
      );

    const result = new Map<
      string,
      Parameters<PurchaseRequestsService['buildWarehouseMetaFromDispatch']>[1]
    >();

    for (const [requestId, dispatches] of grouped.entries()) {
      result.set(
        requestId,
        dispatches.map((dispatch) => this.mapDispatchMeta(dispatch, true)),
      );
    }

    return result;
  }

  @Get()
  findAll(
    @Query('page') page: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('search') search: string | undefined,
    @Query('status') status: string | undefined,
    @Query('dateFrom') dateFrom: string | undefined,
    @Query('dateTo') dateTo: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    const query = new QueryPurchaseRequestsDto();
    query.page = Math.max(1, Number(page) || 1);
    query.limit = Math.min(100, Math.max(1, Number(limit) || 10));
    query.search = search?.trim() || undefined;

    if (
      status &&
      Object.values(PurchaseRequestStatus).includes(
        status as PurchaseRequestStatus,
      )
    ) {
      query.status = status as PurchaseRequestStatus;
    }

    const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;
    const normalizedDateFrom = dateFrom?.trim();
    const normalizedDateTo = dateTo?.trim();
    query.dateFrom =
      normalizedDateFrom && dateOnlyPattern.test(normalizedDateFrom)
        ? normalizedDateFrom
        : undefined;
    query.dateTo =
      normalizedDateTo && dateOnlyPattern.test(normalizedDateTo)
        ? normalizedDateTo
        : undefined;

    return this.purchaseRequestsService.findAllPaginated(
      query,
      user.sub,
      user.role,
    );
  }

  @Get('history')
  findHistory(
    @Query('page') page: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('search') search: string | undefined,
    @Query('status') status: string | undefined,
    @Query('eventType') eventType: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    const query = new QueryPurchaseRequestHistoryDto();
    query.page = Math.max(1, Number(page) || 1);
    query.limit = Math.min(100, Math.max(1, Number(limit) || 10));
    query.search = search?.trim() || undefined;

    if (
      status &&
      Object.values(PurchaseRequestStatus).includes(
        status as PurchaseRequestStatus,
      )
    ) {
      query.status = status as PurchaseRequestStatus;
    }

    if (
      eventType &&
      Object.values(HistoryStepType).includes(eventType as HistoryStepType)
    ) {
      query.eventType = eventType as HistoryStepType;
    }

    return this.purchaseRequestsService.findHistoryEventsPaginated(
      query,
      user.sub,
      user.role,
    );
  }

  @Get('purchasing/inbox')
  findPurchasingInbox(
    @Query('page') page: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('search') search: string | undefined,
    @Query('dateFrom') dateFrom: string | undefined,
    @Query('dateTo') dateTo: string | undefined,
    @Query('structureId') structureId: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    const query = new QueryPurchasingInboxDto();
    query.page = Math.max(1, Number(page) || 1);
    query.limit = Math.min(100, Math.max(1, Number(limit) || 10));
    query.search = search?.trim() || undefined;
    query.dateFrom = dateFrom?.trim() || undefined;
    query.dateTo = dateTo?.trim() || undefined;
    query.structureId = structureId?.trim() || undefined;

    return this.purchaseRequestsService.findPurchasingInboxPaginated(
      query,
      user.sub,
      user.role,
      (ids) => this.buildDispatchMetaLoader(ids),
    );
  }

  @Get('purchased/inbox')
  findPurchasedInbox(
    @Query('page') page: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('search') search: string | undefined,
    @Query('dateFrom') dateFrom: string | undefined,
    @Query('dateTo') dateTo: string | undefined,
    @Query('inboxType') inboxType: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    const query = new QueryPurchasingInboxDto();
    query.page = Math.max(1, Number(page) || 1);
    query.limit = Math.min(100, Math.max(1, Number(limit) || 10));
    query.search = search?.trim() || undefined;
    query.dateFrom = dateFrom?.trim() || undefined;
    query.dateTo = dateTo?.trim() || undefined;
    query.inboxType =
      inboxType === 'unavailable' ? 'unavailable' : 'purchased';

    return this.purchaseRequestsService.findPurchasedInboxPaginated(
      query,
      user.sub,
      user.role,
      (ids) => this.buildPurchasedDispatchDetailLoader(ids),
    );
  }

  @Get('ishonchnoma/inbox')
  findIshonchnomaInbox(
    @Query('page') page: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('search') search: string | undefined,
    @Query('dateFrom') dateFrom: string | undefined,
    @Query('dateTo') dateTo: string | undefined,
    @Query('ishonchnomaStatus') ishonchnomaStatus: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    const query = new QueryPurchasingInboxDto();
    query.page = Math.max(1, Number(page) || 1);
    query.limit = Math.min(100, Math.max(1, Number(limit) || 10));
    query.search = search?.trim() || undefined;
    query.dateFrom = dateFrom?.trim() || undefined;
    query.dateTo = dateTo?.trim() || undefined;
    query.ishonchnomaStatus =
      ishonchnomaStatus === 'pending' || ishonchnomaStatus === 'submitted'
        ? ishonchnomaStatus
        : 'all';

    return this.purchaseRequestsService.findIshonchnomaInboxPaginated(
      query,
      user.sub,
      user.role,
    );
  }

  @Get('approvals/inbox')
  findApprovalInbox(
    @Query('page') page: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('search') search: string | undefined,
    @Query('dateFrom') dateFrom: string | undefined,
    @Query('dateTo') dateTo: string | undefined,
    @Query('structureId') structureId: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    const query = new QueryApprovalInboxDto();
    query.page = Math.max(1, Number(page) || 1);
    query.limit = Math.min(100, Math.max(1, Number(limit) || 10));
    query.search = search?.trim() || undefined;

    const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;
    const normalizedDateFrom = dateFrom?.trim();
    const normalizedDateTo = dateTo?.trim();
    query.dateFrom =
      normalizedDateFrom && dateOnlyPattern.test(normalizedDateFrom)
        ? normalizedDateFrom
        : undefined;
    query.dateTo =
      normalizedDateTo && dateOnlyPattern.test(normalizedDateTo)
        ? normalizedDateTo
        : undefined;
    query.structureId = structureId?.trim() || undefined;

    return this.purchaseRequestsService.findApprovalInboxPaginated(
      query,
      user.sub,
      user.role,
      user.login,
    );
  }

  @Get('active-sessions')
  listActiveSessions(@CurrentUser() user: JwtPayload) {
    return this.purchaseRequestsService.listActiveSessions(user.sub);
  }

  @Post('active-sessions')
  createActiveSession(@CurrentUser() user: JwtPayload) {
    return this.purchaseRequestsService.createActiveSession(user.sub);
  }

  @Post('active-sessions/:sessionId')
  saveActiveSession(
    @Param('sessionId', ParseMongoIdPipe) sessionId: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.purchaseRequestsService.saveActiveSession(
      user.sub,
      sessionId,
      this.purchaseRequestsService.normalizeSessionPayload(body),
    );
  }

  @Post('active-sessions/:sessionId/documents/prepare')
  prepareSessionDocuments(
    @Param('sessionId', ParseMongoIdPipe) sessionId: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: JwtPayload,
  ) {
    const regenerateKelishuvOnly = body?.regenerateKelishuvOnly === true;
    const { regenerateKelishuvOnly: _ignored, ...rest } = body ?? {};
    const dto = this.purchaseRequestsService.normalizeSessionPayload(rest);

    return this.purchaseRequestsService.prepareSessionDocuments(
      user.sub,
      sessionId,
      Object.keys(rest).length ? dto : undefined,
      { regenerateKelishuvOnly },
    );
  }

  @Get('active-sessions/:sessionId/documents/:docType/download')
  @SkipTransform()
  @Header(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  )
  async downloadSessionDocument(
    @Param('sessionId', ParseMongoIdPipe) sessionId: string,
    @Param('docType') docType: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const normalizedType = this.normalizeSessionDocType(docType);
    const file = await this.purchaseRequestsService.downloadSessionDocument(
      user.sub,
      sessionId,
      normalizedType,
    );

    return new StreamableFile(file.buffer, {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      disposition: `attachment; filename="${normalizedType}.docx"`,
    });
  }

  @Post('active-sessions/:sessionId/documents/:docType/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  uploadSessionDocument(
    @Param('sessionId', ParseMongoIdPipe) sessionId: string,
    @Param('docType') docType: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.purchaseRequestsService.uploadSessionDocument(
      user.sub,
      sessionId,
      this.normalizeSessionDocType(docType),
      file as Express.Multer.File,
    );
  }

  @Get('active-sessions/:sessionId/onlyoffice/config')
  getOnlyOfficeConfig(
    @Param('sessionId', ParseMongoIdPipe) sessionId: string,
    @Query('docType') docType: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.buildOnlyOfficeConfig(user, sessionId, docType);
  }

  @Post('active-sessions/:sessionId/submit')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'bildirgi', maxCount: 1 },
        { name: 'kelishuv', maxCount: 1 },
      ],
      {
        storage: memoryStorage(),
        limits: { fileSize: 10 * 1024 * 1024 },
      },
    ),
  )
  submitActiveSession(
    @Param('sessionId', ParseMongoIdPipe) sessionId: string,
    @UploadedFiles()
    files: {
      bildirgi?: Express.Multer.File[];
      kelishuv?: Express.Multer.File[];
    },
    @Body('payload') payload: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.purchaseRequestsService.submitActiveSession(
      user.sub,
      sessionId,
      {
        bildirgi: files?.bildirgi?.[0],
        kelishuv: files?.kelishuv?.[0],
      },
      payload,
    );
  }

  @Delete('active-sessions/:sessionId')
  deleteActiveSession(
    @Param('sessionId', ParseMongoIdPipe) sessionId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.purchaseRequestsService.deleteActiveSession(
      user.sub,
      sessionId,
    );
  }

  private isHistoryView(historyView: string | undefined) {
    return historyView === '1' || historyView === 'true';
  }

  @Get(':id/export/commission/pdf')
  @SkipTransform()
  async exportCommissionPdf(
    @Param('id', ParseMongoIdPipe) id: string,
    @Query('historyView') historyView: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    const request = await this.purchaseRequestsService.findByIdOrFail(
      id,
      user.sub,
      user.role,
      { historyView: this.isHistoryView(historyView) },
    );
    const buffer = await this.commissionDocumentService.generatePdf(request);

    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `attachment; filename="${this.commissionDocumentService.buildFileName(request, 'pdf')}"`,
    });
  }

  @Get(':id/export/commission/docx')
  @SkipTransform()
  @Header(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  )
  async exportCommissionDocx(
    @Param('id', ParseMongoIdPipe) id: string,
    @Query('historyView') historyView: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    const request = await this.purchaseRequestsService.findByIdOrFail(
      id,
      user.sub,
      user.role,
      { historyView: this.isHistoryView(historyView) },
    );
    const buffer = await this.commissionDocumentService.generateDocx(request);

    return new StreamableFile(buffer, {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      disposition: `attachment; filename="${this.commissionDocumentService.buildFileName(request, 'docx')}"`,
    });
  }

  @Get(':id/export/pdf')
  @SkipTransform()
  async exportPdf(
    @Param('id', ParseMongoIdPipe) id: string,
    @Query('historyView') historyView: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    const request = await this.purchaseRequestsService.findByIdOrFail(
      id,
      user.sub,
      user.role,
      { historyView: this.isHistoryView(historyView) },
    );
    const buffer = await this.documentService.generatePdf(request);

    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `attachment; filename="${this.documentService.buildFileName(request, 'pdf')}"`,
    });
  }

  @Get(':id/export/docx')
  @SkipTransform()
  @Header(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  )
  async exportDocx(
    @Param('id', ParseMongoIdPipe) id: string,
    @Query('historyView') historyView: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    const request = await this.purchaseRequestsService.findByIdOrFail(
      id,
      user.sub,
      user.role,
      { historyView: this.isHistoryView(historyView) },
    );
    const buffer = await this.documentService.generateDocx(request);

    return new StreamableFile(buffer, {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      disposition: `attachment; filename="${this.documentService.buildFileName(request, 'docx')}"`,
    });
  }

  @Get(':id/submitted-documents/:docType')
  @SkipTransform()
  async downloadSubmittedDocument(
    @Param('id', ParseMongoIdPipe) id: string,
    @Param('docType') docType: string,
    @CurrentUser() user: JwtPayload,
  ) {
    if (docType !== 'bildirgi' && docType !== 'kelishuv') {
      throw new BadRequestException('Hujjat turi noto‘g‘ri');
    }

    const { file, filePath } =
      await this.purchaseRequestsService.getSubmittedDocument(
        id,
        docType,
        user.sub,
        user.role,
      );

    return new StreamableFile(createReadStream(filePath), {
      type: file.mimeType,
      disposition: `attachment; filename="${encodeURIComponent(file.originalName)}"`,
    });
  }

  @Patch(':id/purchase-batches/:batchId/contract')
  @Post(':id/purchase-batches/:batchId/contract')
  updatePurchaseBatchContract(
    @Param('id', ParseMongoIdPipe) id: string,
    @Param('batchId') batchId: string,
    @Body() dto: UpdatePurchaseBatchContractDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.purchaseRequestsService.updatePurchaseBatchContract(
      id,
      batchId,
      dto,
      user.sub,
      user.role,
    );
  }

  @Get(':id/purchase/files/:storedName')
  @SkipTransform()
  async downloadPurchaseFile(
    @Param('id', ParseMongoIdPipe) id: string,
    @Param('storedName') storedName: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const { file, filePath } =
      await this.purchaseRequestsService.getPurchaseFile(
        id,
        storedName,
        user.sub,
        user.role,
      );

    return new StreamableFile(createReadStream(filePath), {
      type: file.mimeType,
      disposition: `attachment; filename="${encodeURIComponent(file.originalName)}"`,
    });
  }

  @Get('analytics/purchase-statistics')
  getPurchaseStatistics(
    @Query('structureId') structureId: string | undefined,
    @Query('granularity') granularity: string | undefined,
    @Query('year') year: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    const query = new QueryPurchaseStatisticsDto();
    query.structureId = structureId?.trim() || undefined;
    query.granularity =
      granularity === 'monthly' ? 'monthly' : 'yearly';
    query.year = year ? Number(year) : undefined;

    return this.purchaseRequestsService.getPurchaseStatistics(
      query,
      user.sub,
      user.role,
    );
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseMongoIdPipe) id: string,
    @Query('purchasingView') purchasingView: string | undefined,
    @Query('historyView') historyView: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    const isPurchasingView =
      purchasingView === '1' || purchasingView === 'true';
    const isHistoryView = this.isHistoryView(historyView);

    let warehouseDispatch:
      | Parameters<PurchaseRequestsService['buildWarehouseMetaFromDispatch']>[1]
      | undefined;

    if (isPurchasingView) {
      const dispatches =
        await this.warehouseDispatchesService.findAllByPurchaseRequestId(id);

      warehouseDispatch = dispatches.map((dispatch) =>
        this.mapDispatchMeta(dispatch),
      );
    }

    return this.purchaseRequestsService.findByIdPublic(
      id,
      user.sub,
      user.role,
      { purchasingView: isPurchasingView, historyView: isHistoryView },
      warehouseDispatch,
      user.login,
    );
  }

  @Post(':id/purchase')
  @UseInterceptors(
    FilesInterceptor('files', 20, {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  completePurchase(
    @Param('id', ParseMongoIdPipe) id: string,
    @Req() req: Request,
    @Body('vendorName') vendorName: string | undefined,
    @Body('contractNumber') contractNumber: string | undefined,
    @Body('organizationName') organizationName: string | undefined,
    @Body('innOrPinfl') innOrPinfl: string | undefined,
    @Body('innOrPinflType') innOrPinflType: string | undefined,
    @Body('comment') comment: string | undefined,
    @Body('links') linksJson: string | undefined,
    @Body('purchasedItems') purchasedItemsJson: string | undefined,
    @Body('fileLabels') fileLabelsJson: string | undefined,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    const body = (req.body ?? {}) as Record<string, string | undefined>;
    const input = this.parseCompletePurchaseBody({
      vendorName: vendorName ?? body.vendorName,
      contractNumber: contractNumber ?? body.contractNumber,
      organizationName: organizationName ?? body.organizationName,
      innOrPinfl: innOrPinfl ?? body.innOrPinfl,
      innOrPinflType: innOrPinflType ?? body.innOrPinflType,
      comment: comment ?? body.comment,
      linksJson: linksJson ?? body.links,
      purchasedItemsJson: purchasedItemsJson ?? body.purchasedItems,
      fileLabelsJson: fileLabelsJson ?? body.fileLabels,
    });

    return this.purchaseRequestsService.completePurchase(
      id,
      input,
      files ?? [],
      user.sub,
      user.role,
    );
  }

  @Post(':id/purchase/contract')
  updatePurchaseContract(
    @Param('id', ParseMongoIdPipe) id: string,
    @Body() dto: UpdatePurchaseContractBodyDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const { batchId, ...contract } = dto;

    return this.purchaseRequestsService.updatePurchaseBatchContract(
      id,
      batchId,
      contract,
      user.sub,
      user.role,
    );
  }

  @Post(':id/purchase/ishonchnoma')
  @UseInterceptors(
    FilesInterceptor('files', 20, {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  uploadPurchaseIshonchnoma(
    @Param('id', ParseMongoIdPipe) id: string,
    @Req() req: Request,
    @Body('batchId') batchId: string | undefined,
    @Body('fileLabels') fileLabelsJson: string | undefined,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    const body = (req.body ?? {}) as Record<string, string | undefined>;
    const resolvedBatchId = batchId ?? body.batchId;

    if (!resolvedBatchId?.trim()) {
      throw new BadRequestException('Xarid partiyasi aniqlanmadi');
    }

    let fileLabels: string[] = [];

    try {
      const rawLabels = fileLabelsJson ?? body.fileLabels;
      fileLabels = rawLabels ? JSON.parse(rawLabels) : [];
    } catch {
      fileLabels = [];
    }

    return this.purchaseRequestsService.savePurchaseBatchIshonchnoma(
      id,
      resolvedBatchId.trim(),
      files ?? [],
      fileLabels,
      user.sub,
      user.role,
    );
  }

  @Post(':id/purchase/unavailable')
  markItemsUnavailable(
    @Param('id', ParseMongoIdPipe) id: string,
    @Body() dto: MarkItemsUnavailableDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.purchaseRequestsService.markItemsUnavailable(
      id,
      dto,
      user.sub,
      user.role,
    );
  }

  @Post(':id/purchase/reject')
  rejectPurchase(
    @Param('id', ParseMongoIdPipe) id: string,
    @Body() dto: RejectPurchaseDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.purchaseRequestsService.rejectPurchase(
      id,
      dto,
      user.sub,
      user.role,
    );
  }

  @Post()
  create(
    @Body() dto: CreatePurchaseRequestDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.purchaseRequestsService.create(dto, user.sub);
  }

  @Post('ai/polish-item-text')
  polishItemText(@Body() dto: PolishPurchaseItemTextDto) {
    return this.purchaseRequestsService.polishPurchaseItemText(
      dto.name,
      dto.characteristics,
    );
  }

  @Post(':id/edit-session')
  createEditSession(
    @Param('id', ParseMongoIdPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.purchaseRequestsService.createEditSession(
      user.sub,
      id,
      user.role,
    );
  }

  @Post(':id/update-with-documents')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'bildirgi', maxCount: 1 },
        { name: 'kelishuv', maxCount: 1 },
      ],
      {
        storage: memoryStorage(),
        limits: { fileSize: 10 * 1024 * 1024 },
      },
    ),
  )
  updateWithDocuments(
    @Param('id', ParseMongoIdPipe) id: string,
    @UploadedFiles()
    files: {
      bildirgi?: Express.Multer.File[];
      kelishuv?: Express.Multer.File[];
    },
    @Body('payload') payload: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    const dto = this.parseUpdatePurchaseRequestPayload(payload);
    return this.purchaseRequestsService.updateWithDocuments(
      id,
      dto,
      user.sub,
      user.role,
      {
        bildirgi: files?.bildirgi?.[0],
        kelishuv: files?.kelishuv?.[0],
      },
    );
  }

  @Post(':id/update')
  updateByPost(
    @Param('id', ParseMongoIdPipe) id: string,
    @Body() dto: UpdatePurchaseRequestDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.purchaseRequestsService.update(id, dto, user.sub, user.role);
  }

  @Patch(':id')
  update(
    @Param('id', ParseMongoIdPipe) id: string,
    @Body() dto: UpdatePurchaseRequestDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.purchaseRequestsService.update(id, dto, user.sub, user.role);
  }

  @Delete(':id')
  remove(
    @Param('id', ParseMongoIdPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.purchaseRequestsService.remove(id, user.sub, user.role);
  }

  @Post(':id/decisions')
  submitDecision(
    @Param('id', ParseMongoIdPipe) id: string,
    @Body() dto: SubmitApprovalDecisionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.purchaseRequestsService.submitDecision(
      id,
      dto,
      user.sub,
      user.role,
    );
  }

  @Post(':id/resubmit')
  resubmit(
    @Param('id', ParseMongoIdPipe) id: string,
    @Body() dto: ResubmitPurchaseRequestDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.purchaseRequestsService.resubmit(id, dto, user.sub, user.role);
  }

  @Post(':id/resubmit-with-documents')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'bildirgi', maxCount: 1 },
        { name: 'kelishuv', maxCount: 1 },
      ],
      {
        storage: memoryStorage(),
        limits: { fileSize: 10 * 1024 * 1024 },
      },
    ),
  )
  resubmitWithDocuments(
    @Param('id', ParseMongoIdPipe) id: string,
    @UploadedFiles()
    files: {
      bildirgi?: Express.Multer.File[];
      kelishuv?: Express.Multer.File[];
    },
    @Body('payload') payload: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    const dto = this.parseResubmitPurchaseRequestPayload(payload);
    return this.purchaseRequestsService.resubmitWithDocuments(
      id,
      dto,
      user.sub,
      user.role,
      {
        bildirgi: files?.bildirgi?.[0],
        kelishuv: files?.kelishuv?.[0],
      },
    );
  }

  @Post(':id/boss-confirm')
  confirmBossDecision(
    @Param('id', ParseMongoIdPipe) id: string,
    @Body() dto: ConfirmBossDecisionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.purchaseRequestsService.confirmBossDecision(
      id,
      dto,
      user.sub,
      user.role,
      user.login,
    );
  }

  private async buildOnlyOfficeConfig(
    user: JwtPayload,
    sessionId: string,
    docTypeRaw: string | undefined,
  ) {
    const docType = this.normalizeOnlyOfficeDocType(docTypeRaw);
    const meta = await this.purchaseRequestsService.getSessionOnlyOfficeMeta(
      user.sub,
      sessionId,
    );
    const version =
      meta.documentVersions[docType] ??
      (await this.purchaseRequestsService.getSessionDocumentVersion(
        sessionId,
        docType,
      ));

    return this.onlyOfficeService.getEditorConfig(
      sessionId,
      docType,
      meta.documentToken,
      user,
      version,
    );
  }

  private normalizeSessionDocType(value: string | undefined): SessionDocumentType {
    if (value === 'bildirgi' || value === 'kelishuv') {
      return value;
    }

    throw new BadRequestException('docType=bildirgi yoki kelishuv bo‘lishi kerak');
  }

  private normalizeOnlyOfficeDocType(
    value: string | undefined,
  ): SessionDocumentType {
    return this.normalizeSessionDocType(value);
  }

  private parseUpdatePurchaseRequestPayload(
    payload: string | undefined,
  ): UpdatePurchaseRequestDto {
    if (!payload?.trim()) {
      throw new BadRequestException('Ariza ma’lumotlari yuborilmadi');
    }

    try {
      const parsed = JSON.parse(payload) as Record<string, unknown>;
      return this.purchaseRequestsService.normalizeUpdatePayload(parsed);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new BadRequestException('Ariza ma’lumotlari noto‘g‘ri formatda yuborildi');
    }
  }

  private parseResubmitPurchaseRequestPayload(
    payload: string | undefined,
  ): ResubmitPurchaseRequestDto {
    if (!payload?.trim()) {
      throw new BadRequestException('Ariza ma’lumotlari yuborilmadi');
    }

    try {
      const parsed = JSON.parse(payload) as Record<string, unknown>;
      return this.purchaseRequestsService.normalizeResubmitPayload(parsed);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new BadRequestException('Ariza ma’lumotlari noto‘g‘ri formatda yuborildi');
    }
  }

  private parseCompletePurchaseBody(raw: {
    vendorName?: string;
    contractNumber?: string;
    organizationName?: string;
    innOrPinfl?: string;
    innOrPinflType?: string;
    comment?: string;
    linksJson?: string;
    purchasedItemsJson?: string;
    fileLabelsJson?: string;
  }): CompletePurchaseInput {
    let links: CompletePurchaseInput['links'] = [];
    let purchasedItems: CompletePurchaseInput['purchasedItems'] = [];
    let fileLabels: string[] = [];

    try {
      links = raw.linksJson ? JSON.parse(raw.linksJson) : [];
      purchasedItems = raw.purchasedItemsJson
        ? JSON.parse(raw.purchasedItemsJson)
        : [];
      fileLabels = raw.fileLabelsJson ? JSON.parse(raw.fileLabelsJson) : [];
    } catch {
      throw new BadRequestException('Forma ma’lumotlari noto‘g‘ri formatda');
    }

    if (!Array.isArray(links) || !Array.isArray(purchasedItems)) {
      throw new BadRequestException('Forma ma’lumotlari noto‘g‘ri formatda');
    }

    if (!Array.isArray(fileLabels)) {
      fileLabels = [];
    }

    const normalizedPurchasedItems = purchasedItems.map((row, index) => {
      const rawRow = row as unknown as Record<string, unknown>;

      if (
        !Number.isFinite(Number(rawRow.itemIndex)) ||
        !Number.isFinite(Number(rawRow.amount))
      ) {
        throw new BadRequestException(
          `${index + 1}-tovar ma’lumotlari noto‘g‘ri`,
        );
      }

      const rawQuantity = rawRow.quantity;
      const quantity =
        rawQuantity == null || rawQuantity === ''
          ? undefined
          : Number(rawQuantity);

      if (quantity != null && (!Number.isFinite(quantity) || quantity < 1)) {
        throw new BadRequestException(
          `${index + 1}-tovar soni noto‘g‘ri`,
        );
      }

      const rawVatRate = rawRow.vatRate;
      const vatRate =
        rawVatRate == null || rawVatRate === ''
          ? 0
          : Number(rawVatRate);
      const rawVatAmount = rawRow.vatAmount;
      const vatAmount =
        rawVatAmount == null || rawVatAmount === ''
          ? 0
          : Number(rawVatAmount);

      if (!Number.isFinite(vatRate) || ![0, 6, 12].includes(vatRate)) {
        throw new BadRequestException(
          `${index + 1}-tovar QQS foizi noto‘g‘ri`,
        );
      }

      if (!Number.isFinite(vatAmount) || vatAmount < 0) {
        throw new BadRequestException(
          `${index + 1}-tovar QQS summasi noto‘g‘ri`,
        );
      }

      if (vatRate > 0 && vatAmount < 1) {
        throw new BadRequestException(
          `${index + 1}-tovar uchun QQS summasini kiriting`,
        );
      }

      return {
        itemIndex: Number(rawRow.itemIndex),
        amount: Number(rawRow.amount),
        vatRate,
        vatAmount: Math.round(vatAmount),
        name: typeof rawRow.name === 'string' ? rawRow.name : undefined,
        characteristics:
          typeof rawRow.characteristics === 'string'
            ? rawRow.characteristics
            : undefined,
        quantity,
        unit: typeof rawRow.unit === 'string' ? rawRow.unit : undefined,
      };
    });

    return {
      vendorName: raw.vendorName?.trim() ?? '',
      contractNumber: raw.contractNumber?.trim() ?? '',
      organizationName: raw.organizationName?.trim() ?? '',
      innOrPinfl: raw.innOrPinfl?.trim() ?? '',
      innOrPinflType: this.normalizeInnOrPinflType(raw.innOrPinflType),
      comment: raw.comment,
      links,
      purchasedItems: normalizedPurchasedItems,
      fileLabels,
    };
  }

  private normalizeInnOrPinflType(
    value: string | undefined,
  ): '' | 'inn' | 'pinfl' {
    const normalized = value?.trim().toLowerCase();

    if (normalized === 'inn' || normalized === 'pinfl') {
      return normalized;
    }

    return '';
  }
}
