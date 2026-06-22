import { Body, Controller, Get, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { OverrideLoginDto } from './dto/override-login.dto';
import { ReportDeviceTelemetryDto } from './dto/report-device-telemetry.dto';
import { DeviceCompatibilityCheckDto } from './dto/device-compatibility-check.dto';
import { SetGlobalSecondCodeDto } from './dto/set-global-second-code.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import type { JwtPayload } from './interfaces/jwt-payload.interface';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @SkipThrottle()
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(
      dto,
      this.authService.extractDeviceMeta(req, dto),
      req,
    );
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  logout(@CurrentUser() user: JwtPayload, @Req() req: Request) {
    return this.authService.logout(
      user.sub,
      this.authService.extractDeviceMeta(req),
      req,
    );
  }

  @Post('override-login')
  @UseGuards(JwtAuthGuard)
  overrideLogin(
    @CurrentUser() user: JwtPayload,
    @Body() dto: OverrideLoginDto,
    @Req() req: Request,
  ) {
    return this.authService.overrideLogin(
      user.sub,
      user.role,
      dto,
      this.authService.extractDeviceMeta(req, dto),
      req,
    );
  }

  @Get('global-second-code/status')
  @UseGuards(JwtAuthGuard)
  getGlobalSecondCodeStatus(@CurrentUser() user: JwtPayload) {
    return this.authService.getGlobalSecondCodeStatus(user.role);
  }

  @Post('global-second-code')
  @UseGuards(JwtAuthGuard)
  setGlobalSecondCode(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SetGlobalSecondCodeDto,
  ) {
    return this.authService.setGlobalSecondCode(user.role, dto);
  }

  @Post('device-telemetry')
  @UseGuards(JwtAuthGuard)
  reportDeviceTelemetry(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ReportDeviceTelemetryDto,
    @Req() req: Request,
  ) {
    return this.authService.reportDeviceTelemetry(user.sub, dto, req);
  }

  @Post('device-compatibility-check')
  @UseGuards(JwtAuthGuard)
  reportDeviceCompatibilityCheck(
    @CurrentUser() user: JwtPayload,
    @Body() dto: DeviceCompatibilityCheckDto,
    @Req() req: Request,
  ) {
    return this.authService.reportDeviceCompatibilityCheck(user.sub, dto, req);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: JwtPayload, @Req() req: Request) {
    return this.authService.getProfile(
      user.sub,
      this.authService.extractDeviceMeta(req),
    );
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  updateProfile(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateProfileDto,
    @Req() req: Request,
  ) {
    return this.authService.updateProfile(
      user.sub,
      dto,
      this.authService.extractDeviceMeta(req),
    );
  }

  @Patch('me/password')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  changePassword(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(user.sub, dto);
  }
}
