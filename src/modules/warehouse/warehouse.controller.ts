import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ParseMongoIdPipe } from '../../common/pipes/parse-mongo-id.pipe';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CreateWarehouseLocationDto } from './dto/create-warehouse-location.dto';
import { UpdateWarehouseLocationDto } from './dto/update-warehouse-location.dto';
import { CreateWarehouseExpenseDto } from './dto/create-warehouse-expense.dto';
import { QueryWarehouseExpensesDto } from './dto/query-warehouse-expenses.dto';
import { QueryWarehouseFixedAssetsDto } from './dto/query-warehouse-fixed-assets.dto';
import { QueryWarehouseInventoryDto } from './dto/query-warehouse-inventory.dto';
import { UpdateWarehouseInventoryNomenclatureDto } from './dto/update-warehouse-inventory-nomenclature.dto';
import { DiscardWarehouseFixedAssetDto } from './dto/discard-warehouse-fixed-asset.dto';
import { QueryWarehouseImportsDto } from './dto/query-warehouse-imports.dto';
import { SaveWarehouseImportSessionDto } from './dto/save-warehouse-import-session.dto';
import { WarehouseImportService } from './warehouse-import.service';
import { WarehouseService } from './warehouse.service';

@Controller('warehouse')
@UseGuards(JwtAuthGuard)
export class WarehouseController {
  constructor(
    private readonly warehouseService: WarehouseService,
    private readonly warehouseImportService: WarehouseImportService,
  ) {}

  @Get('locations')
  listLocations(@CurrentUser() user: JwtPayload) {
    return this.warehouseService.listLocations(user.sub, user.role);
  }

  @Post('locations')
  createLocation(
    @Body() dto: CreateWarehouseLocationDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.warehouseService.createLocation(dto, user.sub, user.role);
  }

  @Patch('locations/:id')
  updateLocation(
    @Param('id', ParseMongoIdPipe) id: string,
    @Body() dto: UpdateWarehouseLocationDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.warehouseService.updateLocation(id, dto, user.sub, user.role);
  }

  @Delete('locations/:id')
  deleteLocation(
    @Param('id', ParseMongoIdPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.warehouseService.deleteLocation(id, user.sub, user.role);
  }

  @Get('locations/:id/inventory')
  listInventory(
    @Param('id', ParseMongoIdPipe) id: string,
    @Query() query: QueryWarehouseInventoryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.warehouseService.listInventoryByLocation(
      id,
      query,
      user.sub,
      user.role,
    );
  }

  @Get('all/overview')
  listAllWarehousesOverview(@CurrentUser() user: JwtPayload) {
    return this.warehouseService.listAllWarehousesOverview(user.sub, user.role);
  }

  @Get('all/locations/:id/inventory')
  listInventoryFromAllWarehouses(
    @Param('id', ParseMongoIdPipe) id: string,
    @Query() query: QueryWarehouseInventoryDto,
    @Query('structureId') structureId: string | undefined,
  ) {
    return this.warehouseService.listInventoryByAnyLocation(
      id,
      structureId,
      query,
    );
  }

  @Get('locations/:id/inventory/:inventoryId/history')
  getInventoryItemHistory(
    @Param('id', ParseMongoIdPipe) locationId: string,
    @Param('inventoryId', ParseMongoIdPipe) inventoryId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.warehouseService.getInventoryItemHistory(
      locationId,
      inventoryId,
      user.sub,
      user.role,
    );
  }

  @Patch('locations/:id/inventory/:inventoryId/nomenclature')
  updateInventoryNomenclature(
    @Param('id', ParseMongoIdPipe) locationId: string,
    @Param('inventoryId', ParseMongoIdPipe) inventoryId: string,
    @Body() dto: UpdateWarehouseInventoryNomenclatureDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.warehouseService.updateInventoryNomenclature(
      locationId,
      inventoryId,
      dto.nomenclatureCode,
      user.sub,
      user.role,
    );
  }

  @Get('locations/:id/inventory/by-barcode')
  findInventoryByBarcode(
    @Param('id', ParseMongoIdPipe) id: string,
    @Query('barcode') barcode: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.warehouseService.findInventoryItemByBarcode(
      id,
      barcode,
      user.sub,
      user.role,
    );
  }

  @Get('inventory/by-barcode')
  findInventoryByBarcodeGlobally(
    @Query('barcode') barcode: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.warehouseService.findInventoryItemByBarcodeGlobally(
      barcode,
      user.sub,
      user.role,
    );
  }

  @Get('expense-reasons')
  listExpenseReasons() {
    return this.warehouseService.listExpenseReasons();
  }

  @Get('expenses')
  listExpenses(
    @Query() query: QueryWarehouseExpensesDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.warehouseService.listExpensesPaginated(
      query,
      user.sub,
      user.role,
    );
  }

  @Get('expenses/:code')
  findExpenseByCode(
    @Param('code') code: string,
    @Query('structureId') structureId: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.warehouseService.findExpenseByCode(
      decodeURIComponent(code),
      user.sub,
      user.role,
      structureId,
    );
  }

  @Post('expenses')
  createExpense(
    @Body() dto: CreateWarehouseExpenseDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.warehouseService.createExpense(dto, user.sub, user.role);
  }

  @Delete('expenses/:code')
  deleteExpenseByCode(
    @Param('code') code: string,
    @Query('structureId') structureId: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.warehouseService.deleteExpenseByCode(
      decodeURIComponent(code),
      user.sub,
      user.role,
      structureId,
    );
  }

  @Get('fixed-assets')
  listFixedAssets(
    @Query() query: QueryWarehouseFixedAssetsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.warehouseService.listFixedAssetsPaginated(
      query,
      user.sub,
      user.role,
    );
  }

  @Post('fixed-assets/:id/return')
  returnFixedAsset(
    @Param('id', ParseMongoIdPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.warehouseService.returnFixedAssetToWarehouse(
      id,
      user.sub,
      user.role,
    );
  }

  @Post('fixed-assets/:id/discard')
  discardFixedAsset(
    @Param('id', ParseMongoIdPipe) id: string,
    @Body() dto: DiscardWarehouseFixedAssetDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.warehouseService.discardFixedAsset(
      id,
      dto.reason,
      user.sub,
      user.role,
    );
  }

  @Get('imports')
  listImports(
    @Query() query: QueryWarehouseImportsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.warehouseImportService.listImportsPaginated(
      query,
      user.sub,
      user.role,
    );
  }

  @Get('imports/active-sessions')
  listImportActiveSessions(@CurrentUser() user: JwtPayload) {
    return this.warehouseImportService.listActiveSessions(user.sub, user.role);
  }

  @Post('imports/active-sessions')
  createImportActiveSession(@CurrentUser() user: JwtPayload) {
    return this.warehouseImportService.createActiveSession(user.sub, user.role);
  }

  @Post('imports/active-sessions/:sessionId')
  saveImportActiveSession(
    @Param('sessionId', ParseMongoIdPipe) sessionId: string,
    @Body() dto: SaveWarehouseImportSessionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.warehouseImportService.saveActiveSession(
      user.sub,
      sessionId,
      dto,
      user.role,
    );
  }

  @Post('imports/active-sessions/:sessionId/submit')
  submitImportActiveSession(
    @Param('sessionId', ParseMongoIdPipe) sessionId: string,
    @Body() dto: SaveWarehouseImportSessionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.warehouseImportService.submitActiveSession(
      user.sub,
      sessionId,
      dto,
      user.role,
    );
  }

  @Delete('imports/active-sessions/:sessionId')
  deleteImportActiveSession(
    @Param('sessionId', ParseMongoIdPipe) sessionId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.warehouseImportService.deleteActiveSession(
      user.sub,
      sessionId,
      user.role,
    );
  }

  @Get('imports/:id')
  findImport(
    @Param('id', ParseMongoIdPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.warehouseImportService.findImportById(id, user.sub, user.role);
  }
}
