import {
  Body,
  Controller,
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
import { CreateStocktakeDto } from './dto/create-stocktake.dto';
import { QueryStocktakesDto } from './dto/query-stocktakes.dto';
import { ScanStocktakeBarcodeDto } from './dto/scan-stocktake-barcode.dto';
import { UpdateStocktakeLineDto } from './dto/update-stocktake-line.dto';
import { ApplyExcessAdjustmentsDto } from './dto/apply-excess-adjustments.dto';
import { StocktakesService } from './stocktakes.service';

@Controller('stocktakes')
@UseGuards(JwtAuthGuard)
export class StocktakesController {
  constructor(private readonly stocktakesService: StocktakesService) {}

  @Get('management')
  listForManagement(
    @Query() query: QueryStocktakesDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.stocktakesService.listForManagement(query, user.sub, user.role);
  }

  @Get('active')
  findActive(@CurrentUser() user: JwtPayload) {
    return this.stocktakesService.findActive(user.sub);
  }

  @Get()
  findAll(@Query() query: QueryStocktakesDto, @CurrentUser() user: JwtPayload) {
    return this.stocktakesService.findAll(query, user.sub, user.role);
  }

  @Get(':id/management')
  getManagementDetail(
    @Param('id', ParseMongoIdPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.stocktakesService.getManagementDetail(id, user.sub, user.role);
  }

  @Post(':id/excess-adjustments')
  applyExcessAdjustments(
    @Param('id', ParseMongoIdPipe) id: string,
    @Body() dto: ApplyExcessAdjustmentsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.stocktakesService.applyExcessAdjustments(
      id,
      dto,
      user.sub,
      user.role,
    );
  }

  @Get(':id/search')
  searchLines(
    @Param('id', ParseMongoIdPipe) id: string,
    @Query('q') q: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.stocktakesService.searchLines(id, q, user.sub, user.role);
  }

  @Get(':id')
  findById(
    @Param('id', ParseMongoIdPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.stocktakesService.findById(id, user.sub, user.role);
  }

  @Post()
  create(@Body() dto: CreateStocktakeDto, @CurrentUser() user: JwtPayload) {
    return this.stocktakesService.create(dto, user.sub, user.role);
  }

  @Patch(':id/lines')
  updateLine(
    @Param('id', ParseMongoIdPipe) id: string,
    @Body() dto: UpdateStocktakeLineDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.stocktakesService.updateLine(id, dto, user.sub, user.role);
  }

  @Post(':id/scan')
  scanBarcode(
    @Param('id', ParseMongoIdPipe) id: string,
    @Body() dto: ScanStocktakeBarcodeDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.stocktakesService.scanBarcode(id, dto, user.sub, user.role);
  }

  @Post(':id/complete')
  complete(
    @Param('id', ParseMongoIdPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.stocktakesService.complete(id, user.sub, user.role);
  }

  @Post(':id/cancel')
  cancel(
    @Param('id', ParseMongoIdPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.stocktakesService.cancel(id, user.sub, user.role);
  }
}
