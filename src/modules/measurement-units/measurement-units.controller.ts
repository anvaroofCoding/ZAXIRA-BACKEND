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
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { UsersService } from '../users/users.service';
import { MEASUREMENT_UNITS_PAGE_PATH } from './constants/measurement-units-page-path';
import { CreateCustomMeasurementUnitDto } from './dto/create-custom-measurement-unit.dto';
import { QueryCustomMeasurementUnitsDto } from './dto/query-custom-measurement-units.dto';
import { UpdateCustomMeasurementUnitDto } from './dto/update-custom-measurement-unit.dto';
import { MeasurementUnitsService } from './measurement-units.service';

@Controller('measurement-units')
@UseGuards(JwtAuthGuard)
export class MeasurementUnitsController {
  constructor(
    private readonly measurementUnitsService: MeasurementUnitsService,
    private readonly usersService: UsersService,
  ) {}

  @Get('options')
  getOptions(@CurrentUser() user: JwtPayload) {
    return this.measurementUnitsService.getOptions(user.sub);
  }

  @Post('custom')
  createCustom(
    @Body() dto: CreateCustomMeasurementUnitDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.measurementUnitsService.createForUser(user.sub, dto);
  }

  @Get('custom')
  async findAllCustom(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @CurrentUser() user?: JwtPayload,
  ) {
    await this.measurementUnitsService.assertPageAccess(user!.sub, user!.role);

    const query = new QueryCustomMeasurementUnitsDto();
    query.page = Math.max(1, Number(page) || 1);
    query.limit = Math.min(100, Math.max(1, Number(limit) || 10));
    query.search = search?.trim() || undefined;

    return this.measurementUnitsService.findAllPaginated(query);
  }

  @Patch('custom/:id')
  async updateCustom(
    @Param('id') id: string,
    @Body() dto: UpdateCustomMeasurementUnitDto,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.usersService.assertPageActionPermission(
      user.sub,
      user.role,
      MEASUREMENT_UNITS_PAGE_PATH,
      'update',
    );

    return this.measurementUnitsService.update(id, dto);
  }

  @Delete('custom/:id')
  async removeCustom(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.usersService.assertPageActionPermission(
      user.sub,
      user.role,
      MEASUREMENT_UNITS_PAGE_PATH,
      'delete',
    );

    return this.measurementUnitsService.remove(id);
  }
}
