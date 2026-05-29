import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  getSummary(
    @Query('structureId') structureId: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.dashboardService.getSummary({ structureId }, user.sub, user.role);
  }

  @Get('analytics/monthly-max')
  getMonthlyMax(
    @Query('structureId') structureId: string | undefined,
    @Query('months') months: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    const parsedMonths = Math.min(48, Math.max(1, Number(months) || 12));
    return this.dashboardService.getMonthlyMaxInventory(
      { structureId, months: parsedMonths },
      user.sub,
      user.role,
    );
  }

  @Get('analytics/daily-max')
  getDailyMax(
    @Query('structureId') structureId: string | undefined,
    @Query('days') days: string | undefined,
    @Query('offsetDays') offsetDays: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    const parsedDays = Math.min(120, Math.max(7, Number(days) || 30));
    const parsedOffsetDays = Math.max(-365, Math.min(365, Number(offsetDays) || 0));
    return this.dashboardService.getDailyMaxInventory(
      { structureId, days: parsedDays, offsetDays: parsedOffsetDays },
      user.sub,
      user.role,
    );
  }
}

