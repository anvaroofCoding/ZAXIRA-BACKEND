import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Post,
  Query,
  StreamableFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
  forwardRef,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
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
import { QueryPurchaseRequestsDto } from './dto/query-purchase-requests.dto';
import { QueryPurchasingInboxDto } from './dto/query-purchasing-inbox.dto';
import { CompletePurchaseInput } from './types/complete-purchase-input.type';
import { ResubmitPurchaseRequestDto } from './dto/resubmit-purchase-request.dto';
import { SubmitApprovalDecisionDto } from './dto/submit-approval-decision.dto';
import { PurchaseRequestDocumentService } from './purchase-request-document.service';
import { PurchaseRequestsService } from './purchase-requests.service';
import { WarehouseDispatchesService } from '../warehouse-dispatches/warehouse-dispatches.service';

@Controller('purchase-requests')
@UseGuards(JwtAuthGuard)
export class PurchaseRequestsController {
  constructor(
    private readonly purchaseRequestsService: PurchaseRequestsService,
    private readonly documentService: PurchaseRequestDocumentService,
    @Inject(forwardRef(() => WarehouseDispatchesService))
    private readonly warehouseDispatchesService: WarehouseDispatchesService,
  ) {}

  private async buildDispatchMetaLoader(ids: string[]) {
    const map = await this.warehouseDispatchesService.findMapByPurchaseRequestIds(
      ids,
    );

    const result = new Map<
      string,
      Parameters<PurchaseRequestsService['buildWarehouseMetaFromDispatch']>[1]
    >();

    for (const [requestId, dispatch] of map.entries()) {
      result.set(requestId, {
        id: dispatch.id,
        dispatchCode: dispatch.dispatchCode,
        status: dispatch.status,
        targetStructure: { shortName: dispatch.targetStructure.shortName },
      });
    }

    return result;
  }

  private async buildPurchasedDispatchDetailLoader(ids: string[]) {
    const map = await this.warehouseDispatchesService.findMapByPurchaseRequestIds(
      ids,
    );

    const result = new Map<
      string,
      Parameters<PurchaseRequestsService['buildWarehouseMetaFromDispatch']>[1]
    >();

    for (const [requestId, dispatch] of map.entries()) {
      result.set(requestId, {
        id: dispatch.id,
        dispatchCode: dispatch.dispatchCode,
        status: dispatch.status,
        targetStructure: { shortName: dispatch.targetStructure.shortName },
        receipt: this.warehouseDispatchesService.mapReceiptPublic(dispatch),
      });
    }

    return result;
  }

  @Get()
  findAll(
    @Query('page') page: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('search') search: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    const query = new QueryPurchaseRequestsDto();
    query.page = Math.max(1, Number(page) || 1);
    query.limit = Math.min(100, Math.max(1, Number(limit) || 10));
    query.search = search?.trim() || undefined;

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
      Object.values(PurchaseRequestStatus).includes(status as PurchaseRequestStatus)
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
    @CurrentUser() user: JwtPayload,
  ) {
    const query = new QueryPurchasingInboxDto();
    query.page = Math.max(1, Number(page) || 1);
    query.limit = Math.min(100, Math.max(1, Number(limit) || 10));
    query.search = search?.trim() || undefined;
    query.dateFrom = dateFrom?.trim() || undefined;
    query.dateTo = dateTo?.trim() || undefined;

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
    @CurrentUser() user: JwtPayload,
  ) {
    const query = new QueryPurchasingInboxDto();
    query.page = Math.max(1, Number(page) || 1);
    query.limit = Math.min(100, Math.max(1, Number(limit) || 10));
    query.search = search?.trim() || undefined;
    query.dateFrom = dateFrom?.trim() || undefined;
    query.dateTo = dateTo?.trim() || undefined;

    return this.purchaseRequestsService.findPurchasedInboxPaginated(
      query,
      user.sub,
      user.role,
      (ids) => this.buildPurchasedDispatchDetailLoader(ids),
    );
  }

  @Get('approvals/inbox')
  findApprovalInbox(
    @Query('page') page: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('search') search: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    const query = new QueryApprovalInboxDto();
    query.page = Math.max(1, Number(page) || 1);
    query.limit = Math.min(100, Math.max(1, Number(limit) || 10));
    query.search = search?.trim() || undefined;

    return this.purchaseRequestsService.findApprovalInboxPaginated(
      query,
      user.sub,
      user.role,
    );
  }

  @Get(':id/export/pdf')
  @SkipTransform()
  @Header('Content-Type', 'application/pdf')
  async exportPdf(
    @Param('id', ParseMongoIdPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const request = await this.purchaseRequestsService.findByIdOrFail(
      id,
      user.sub,
      user.role,
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
    @CurrentUser() user: JwtPayload,
  ) {
    const request = await this.purchaseRequestsService.findByIdOrFail(
      id,
      user.sub,
      user.role,
    );
    const buffer = await this.documentService.generateDocx(request);

    return new StreamableFile(buffer, {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      disposition: `attachment; filename="${this.documentService.buildFileName(request, 'docx')}"`,
    });
  }

  @Get(':id/purchase/files/:storedName')
  @SkipTransform()
  async downloadPurchaseFile(
    @Param('id', ParseMongoIdPipe) id: string,
    @Param('storedName') storedName: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const { file, filePath } = await this.purchaseRequestsService.getPurchaseFile(
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

  @Get(':id')
  async findOne(
    @Param('id', ParseMongoIdPipe) id: string,
    @Query('purchasingView') purchasingView: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    const isPurchasingView =
      purchasingView === '1' || purchasingView === 'true';

    let warehouseDispatch:
      | Parameters<PurchaseRequestsService['buildWarehouseMetaFromDispatch']>[1]
      | undefined;

    if (isPurchasingView) {
      const dispatch =
        await this.warehouseDispatchesService.findByPurchaseRequestId(id);

      warehouseDispatch = dispatch
        ? {
            id: dispatch.id,
            dispatchCode: dispatch.dispatchCode,
            status: dispatch.status,
            targetStructure: {
              shortName: dispatch.targetStructure.shortName,
            },
          }
        : null;
    }

    return this.purchaseRequestsService.findByIdPublic(
      id,
      user.sub,
      user.role,
      { purchasingView: isPurchasingView },
      warehouseDispatch,
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
    @Body('vendorName') vendorName: string | undefined,
    @Body('comment') comment: string | undefined,
    @Body('links') linksJson: string | undefined,
    @Body('itemAmounts') itemAmountsJson: string | undefined,
    @Body('fileLabels') fileLabelsJson: string | undefined,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    const input = this.parseCompletePurchaseBody({
      vendorName,
      comment,
      linksJson,
      itemAmountsJson,
      fileLabelsJson,
    });

    return this.purchaseRequestsService.completePurchase(
      id,
      input,
      files ?? [],
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
    );
  }

  private parseCompletePurchaseBody(raw: {
    vendorName?: string;
    comment?: string;
    linksJson?: string;
    itemAmountsJson?: string;
    fileLabelsJson?: string;
  }): CompletePurchaseInput {
    if (!raw.vendorName?.trim()) {
      throw new BadRequestException('Firma nomi kiritilishi shart');
    }

    let links: CompletePurchaseInput['links'] = [];
    let itemAmounts: CompletePurchaseInput['itemAmounts'] = [];
    let fileLabels: string[] = [];

    try {
      links = raw.linksJson ? JSON.parse(raw.linksJson) : [];
      itemAmounts = raw.itemAmountsJson ? JSON.parse(raw.itemAmountsJson) : [];
      fileLabels = raw.fileLabelsJson ? JSON.parse(raw.fileLabelsJson) : [];
    } catch {
      throw new BadRequestException('Forma ma’lumotlari noto‘g‘ri formatda');
    }

    if (!Array.isArray(links) || !Array.isArray(itemAmounts)) {
      throw new BadRequestException('Forma ma’lumotlari noto‘g‘ri formatda');
    }

    if (!Array.isArray(fileLabels)) {
      fileLabels = [];
    }

    return {
      vendorName: raw.vendorName,
      comment: raw.comment,
      links,
      itemAmounts,
      fileLabels,
    };
  }
}
