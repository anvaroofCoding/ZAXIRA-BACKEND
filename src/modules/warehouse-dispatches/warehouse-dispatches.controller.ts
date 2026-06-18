import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { createReadStream } from 'fs';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SkipTransform } from '../../common/decorators/skip-transform.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ParseMongoIdPipe } from '../../common/pipes/parse-mongo-id.pipe';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { PurchaseRequestsService } from '../purchase-requests/purchase-requests.service';
import { CreateWarehouseDispatchDto } from './dto/create-warehouse-dispatch.dto';
import { CreateTransferDispatchDto } from './dto/create-transfer-dispatch.dto';
import { CancelTransferDispatchDto } from './dto/cancel-transfer-dispatch.dto';
import { QueryWarehouseDispatchInboxDto } from './dto/query-warehouse-dispatch-inbox.dto';
import { ReceiveWarehouseDispatchDto } from './dto/receive-warehouse-dispatch.dto';
import { WarehouseDispatchDocumentService } from './warehouse-dispatch-document.service';
import { WarehouseDispatchesService } from './warehouse-dispatches.service';

@Controller('warehouse-dispatches')
@UseGuards(JwtAuthGuard)
export class WarehouseDispatchesController {
  constructor(
    private readonly warehouseDispatchesService: WarehouseDispatchesService,
    private readonly documentService: WarehouseDispatchDocumentService,
    private readonly purchaseRequestsService: PurchaseRequestsService,
  ) {}

  @Get('receipt/inbox')
  findReceiptInbox(
    @Query('page') page: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('search') search: string | undefined,
    @Query('dateFrom') dateFrom: string | undefined,
    @Query('dateTo') dateTo: string | undefined,
    @Query('source') source: string | undefined,
    @Query('scope') scope: string | undefined,
    @Query('structureId') structureId: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    const query = new QueryWarehouseDispatchInboxDto();
    query.page = Math.max(1, Number(page) || 1);
    query.limit = Math.min(100, Math.max(1, Number(limit) || 10));
    query.search = search?.trim() || undefined;
    query.dateFrom = dateFrom?.trim() || undefined;
    query.dateTo = dateTo?.trim() || undefined;
    query.source = source?.trim() || undefined;
    query.scope = scope?.trim() || undefined;
    query.structureId = structureId?.trim() || undefined;

    return this.warehouseDispatchesService.findReceiptInboxPaginated(
      query,
      user.sub,
      user.role,
    );
  }

  @Get('cancel-reasons')
  getTransferCancelReasons() {
    return this.warehouseDispatchesService.getTransferCancelReasons();
  }

  @Get('receipt/pending-count')
  countPending(@CurrentUser() user: JwtPayload) {
    return this.warehouseDispatchesService.countPendingReceipt(
      user.sub,
      user.role,
    );
  }

  @Get(':id')
  findOne(
    @Param('id', ParseMongoIdPipe) id: string,
    @Query('markSeen') markSeen: string | undefined,
    @Query('source') source: string | undefined,
    @Query('scope') scope: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.warehouseDispatchesService.findByIdPublic(
      id,
      user.sub,
      user.role,
      {
        markSeen: markSeen === '1' || markSeen === 'true',
        source: source?.trim() || undefined,
        scope: scope?.trim() || undefined,
      },
    );
  }

  @Get(':id/nakladnoy/pdf')
  @SkipTransform()
  async exportNakladnoyPdf(@Param('id', ParseMongoIdPipe) id: string) {
    const dispatch = await this.warehouseDispatchesService.findByIdOrFail(id);
    const buffer = await this.documentService.generatePdf(dispatch);

    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `attachment; filename="${this.documentService.buildFileName(dispatch, 'pdf')}"`,
    });
  }

  @Get(':id/nakladnoy/docx')
  @SkipTransform()
  @Header(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  )
  async exportNakladnoyDocx(@Param('id', ParseMongoIdPipe) id: string) {
    const dispatch = await this.warehouseDispatchesService.findByIdOrFail(id);
    const buffer = await this.documentService.generateDocx(dispatch);

    return new StreamableFile(buffer, {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      disposition: `attachment; filename="${this.documentService.buildFileName(dispatch, 'docx')}"`,
    });
  }

  @Post()
  create(
    @Body() dto: CreateWarehouseDispatchDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.warehouseDispatchesService.create(dto, user.sub, user.role);
  }

  @Post('transfer')
  createTransfer(
    @Body() dto: CreateTransferDispatchDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.warehouseDispatchesService.createTransfer(
      dto,
      user.sub,
      user.role,
    );
  }

  @Post(':id/cancel')
  cancelTransfer(
    @Param('id', ParseMongoIdPipe) id: string,
    @Body() dto: CancelTransferDispatchDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.warehouseDispatchesService.cancelTransfer(
      id,
      dto,
      user.sub,
      user.role,
    );
  }

  @Post(':id/receive')
  receive(
    @Param('id', ParseMongoIdPipe) id: string,
    @Body() dto: ReceiveWarehouseDispatchDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.warehouseDispatchesService.receive(
      id,
      dto,
      user.sub,
      user.role,
    );
  }
}
