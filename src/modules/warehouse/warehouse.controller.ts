import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ParseMongoIdPipe } from '../../common/pipes/parse-mongo-id.pipe';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CreateWarehouseLocationDto } from './dto/create-warehouse-location.dto';
import { CreateWarehouseExpenseDto } from './dto/create-warehouse-expense.dto';
import { QueryWarehouseInventoryDto } from './dto/query-warehouse-inventory.dto';
import { WarehouseService } from './warehouse.service';

@Controller('warehouse')
@UseGuards(JwtAuthGuard)
export class WarehouseController {
  constructor(private readonly warehouseService: WarehouseService) {}

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

  @Get('locations/:id/inventory')
  listInventory(
    @Param('id', ParseMongoIdPipe) id: string,
    @Query() query: QueryWarehouseInventoryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.warehouseService.listInventoryByLocation(id, query, user.sub, user.role);
  }

  @Get('all/overview')
  listAllWarehousesOverview() {
    return this.warehouseService.listAllWarehousesOverview();
  }

  @Get('all/locations/:id/inventory')
  listInventoryFromAllWarehouses(
    @Param('id', ParseMongoIdPipe) id: string,
    @Query() query: QueryWarehouseInventoryDto,
    @Query('structureId') structureId: string | undefined,
  ) {
    return this.warehouseService.listInventoryByAnyLocation(id, structureId, query);
  }

  @Get('locations/:id/inventory/by-barcode')
  findInventoryByBarcode(
    @Param('id', ParseMongoIdPipe) id: string,
    @Query('barcode') barcode: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.warehouseService.findInventoryItemByBarcode(id, barcode, user.sub, user.role);
  }

  @Get('inventory/by-barcode')
  findInventoryByBarcodeGlobally(
    @Query('barcode') barcode: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.warehouseService.findInventoryItemByBarcodeGlobally(barcode, user.sub, user.role);
  }

  @Get('expense-reasons')
  listExpenseReasons() {
    return this.warehouseService.listExpenseReasons();
  }

  @Post('expenses')
  createExpense(
    @Body() dto: CreateWarehouseExpenseDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.warehouseService.createExpense(dto, user.sub, user.role);
  }
}

