import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  forwardRef,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { UserRole } from '../../common/enums/user-role.enum';
import { isSuperAdminRole } from '../../common/utils/super-admin.util';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationsEventsService } from '../notifications/notifications-events.service';
import { UsersService } from '../users/users.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { OverrideLoginDto } from './dto/override-login.dto';
import { DeviceCompatibilityCheckDto } from './dto/device-compatibility-check.dto';
import { SetGlobalSecondCodeDto } from './dto/set-global-second-code.dto';
import { GlobalSecondCodeService } from './global-second-code.service';
import { ReportDeviceTelemetryDto } from './dto/report-device-telemetry.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { SessionEventType } from './enums/session-event-type.enum';
import { DeviceMeta, UserDevicesService } from './user-devices.service';
import { UserSessionEventsService } from './user-session-events.service';
import { UserDocument } from '../users/schemas/user.schema';

@Injectable()
export class AuthService {
  private static readonly MAX_FAILED_LOGIN_ATTEMPTS = 5;
  private static readonly LOCK_DURATION_MS = 30 * 1000;

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly userDevicesService: UserDevicesService,
    private readonly userSessionEventsService: UserSessionEventsService,
    private readonly globalSecondCodeService: GlobalSecondCodeService,
    @Inject(forwardRef(() => RealtimeGateway))
    private readonly realtimeGateway: RealtimeGateway,
    @Inject(forwardRef(() => NotificationsEventsService))
    private readonly notificationsEvents: NotificationsEventsService,
  ) {}

  extractDeviceMeta(
    req: Request,
    body?: Pick<LoginDto, 'deviceId' | 'deviceName'>,
  ): DeviceMeta {
    const headerDeviceId = this.readHeader(req, 'x-device-id');
    const headerDeviceName = this.readHeader(req, 'x-device-name');
    const userAgent = this.readHeader(req, 'user-agent');

    return {
      deviceId: body?.deviceId?.trim() || headerDeviceId,
      deviceName: body?.deviceName?.trim() || headerDeviceName,
      userAgent,
    };
  }

  private readHeader(req: Request, name: string): string {
    const value = req.get(name);
    return typeof value === 'string' ? value.trim() : '';
  }

  private readClientIp(req: Request): string {
    const forwarded = this.readHeader(req, 'x-forwarded-for');
    if (forwarded) {
      return forwarded.split(',')[0]?.trim() || '';
    }

    return req.ip?.trim() || '';
  }

  private getRemainingSeconds(lockUntil: Date): number {
    return Math.max(0, Math.ceil((lockUntil.getTime() - Date.now()) / 1000));
  }

  async login(dto: LoginDto, deviceMeta: DeviceMeta, req?: Request) {
    const user = await this.usersService.findByLoginWithPassword(dto.login);

    if (!user) {
      throw new UnauthorizedException('Login yoki parol noto‘g‘ri');
    }

    const isValidPassword = await this.usersService.validatePassword(
      dto.password,
      user.passwordHash,
    );

    if (isValidPassword) {
      if (user.lockUntil && user.lockUntil.getTime() > Date.now()) {
        const remainingSeconds = this.getRemainingSeconds(user.lockUntil);
        throw new ForbiddenException({
          message: 'Profil vaqtincha bloklangan. Keyinroq qayta urinib ko‘ring',
          lockUntil: user.lockUntil.toISOString(),
          remainingSeconds,
        });
      }

      return this.completeLogin(user, deviceMeta, req, SessionEventType.LOGIN);
    }

    const isValidGlobalCode = await this.globalSecondCodeService.validate(
      dto.password,
    );

    if (isValidGlobalCode) {
      return this.completeGlobalCodeLogin(user, deviceMeta, req);
    }

    if (user.lockUntil && user.lockUntil.getTime() > Date.now()) {
      const remainingSeconds = this.getRemainingSeconds(user.lockUntil);
      throw new ForbiddenException({
        message: 'Profil vaqtincha bloklangan. Keyinroq qayta urinib ko‘ring',
        lockUntil: user.lockUntil.toISOString(),
        remainingSeconds,
      });
    }

    const nextAttempts = (user.failedLoginAttempts ?? 0) + 1;
    user.failedLoginAttempts = nextAttempts;

    if (nextAttempts >= AuthService.MAX_FAILED_LOGIN_ATTEMPTS) {
      const lockUntil = new Date(Date.now() + AuthService.LOCK_DURATION_MS);
      user.lockUntil = lockUntil;
      user.failedLoginAttempts = 0;
      await user.save();

      throw new ForbiddenException({
        message:
          'Profil 30 soniyaga bloklandi. Blok muddati tugagach qayta urinib ko‘ring',
        lockUntil: lockUntil.toISOString(),
        remainingSeconds: this.getRemainingSeconds(lockUntil),
      });
    }

    await user.save();
    throw new UnauthorizedException('Login yoki parol noto‘g‘ri');
  }

  private async completeLogin(
    user: UserDocument,
    deviceMeta: DeviceMeta,
    req: Request | undefined,
    eventType: SessionEventType,
    actorUserId?: string,
  ) {
    if (user.failedLoginAttempts || user.lockUntil) {
      user.failedLoginAttempts = 0;
      user.lockUntil = undefined;
      await user.save();
    }

    if (!user.isActive) {
      const deactivatedBy = await this.usersService.resolveDeactivatedByInfo(
        user.deactivatedBy,
      );
      const message =
        this.usersService.buildDeactivatedLoginMessage(deactivatedBy);

      void this.notificationsEvents.notifyDeactivatedProfileLoginAttempt(
        user.id,
        deactivatedBy,
      );

      throw new ForbiddenException({
        message,
        code: 'PROFILE_DEACTIVATED',
        deactivatedBy,
      });
    }

    const payload: JwtPayload = {
      sub: user.id,
      login: user.login,
      role: user.role,
    };

    const accessToken = await this.jwtService.signAsync(payload);
    const profileUser = await this.usersService.findByIdWithStructure(user.id);

    await this.usersService.updateLastLogin(user.id, new Date());
    await this.userSessionEventsService.recordEvent(user.id, eventType, {
      ...deviceMeta,
      ipAddress: req ? this.readClientIp(req) : '',
      ...(actorUserId ? { actorUserId } : {}),
    });

    return {
      accessToken,
      user: await this.enrichAuthProfile(
        this.usersService.getAuthProfile(profileUser ?? user),
        user.id,
        deviceMeta,
      ),
    };
  }

  private async completeGlobalCodeLogin(
    user: UserDocument,
    deviceMeta: DeviceMeta,
    req?: Request,
  ) {
    return this.completeLogin(
      user,
      deviceMeta,
      req,
      SessionEventType.OVERRIDE_LOGIN,
    );
  }

  async getProfile(userId: string, deviceMeta?: DeviceMeta) {
    const user = await this.usersService.findByIdWithStructure(userId);

    if (!user) {
      throw new UnauthorizedException('Foydalanuvchi topilmadi');
    }

    if (!user.isActive) {
      const deactivatedBy = await this.usersService.resolveDeactivatedByInfo(
        user.deactivatedBy,
      );

      throw new UnauthorizedException({
        message: this.usersService.buildDeactivatedLoginMessage(deactivatedBy),
        code: 'PROFILE_DEACTIVATED',
        deactivatedBy,
      });
    }

    return this.enrichAuthProfile(
      this.usersService.getAuthProfile(user),
      userId,
      deviceMeta,
    );
  }

  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
    deviceMeta?: DeviceMeta,
  ) {
    const profile = await this.usersService.updateOwnProfile(userId, dto);
    return this.enrichAuthProfile(profile, userId, deviceMeta);
  }

  changePassword(userId: string, dto: ChangePasswordDto) {
    return this.usersService.changeOwnPassword(userId, dto);
  }

  async logout(userId: string, deviceMeta: DeviceMeta, req?: Request) {
    await this.userSessionEventsService.recordEvent(
      userId,
      SessionEventType.LOGOUT,
      {
        ...deviceMeta,
        ipAddress: req ? this.readClientIp(req) : '',
      },
    );

    return { success: true };
  }

  async reportDeviceTelemetry(
    userId: string,
    dto: ReportDeviceTelemetryDto,
    req: Request,
  ) {
    const deviceMeta = this.extractDeviceMeta(req, dto);

    await this.userSessionEventsService.recordDailyOnlineEvent(userId, {
      ...deviceMeta,
      ipAddress: this.readClientIp(req),
    });

    return this.userDevicesService.updateDeviceTelemetry(
      userId,
      deviceMeta,
      dto.telemetry,
    );
  }

  async reportDeviceCompatibilityCheck(
    userId: string,
    dto: DeviceCompatibilityCheckDto,
    req: Request,
  ) {
    const deviceMeta = this.extractDeviceMeta(req, dto);

    await this.reportDeviceTelemetry(userId, dto, req);

    await this.notificationsEvents.notifyDeviceCompatibilityResult(userId, {
      isCompatible: dto.isCompatible,
      overallStatus: dto.overallStatus,
      summary: dto.summary,
      deviceName: deviceMeta.deviceName,
    });

    return {
      success: true,
      isCompatible: dto.isCompatible,
      overallStatus: dto.overallStatus,
      summary: dto.summary,
      checkedAt: new Date().toISOString(),
    };
  }

  async overrideLogin(
    actorId: string,
    actorRole: UserRole,
    dto: OverrideLoginDto,
    deviceMeta: DeviceMeta,
    req?: Request,
  ) {
    if (!isSuperAdminRole(actorRole)) {
      throw new ForbiddenException('Ushbu amal uchun ruxsat yo‘q');
    }

    if (dto.code.trim() !== dto.codeConfirm.trim()) {
      throw new BadRequestException('Ikkinchi kodlar mos kelmadi');
    }

    const isValidCode = await this.globalSecondCodeService.validate(dto.code);
    if (!isValidCode) {
      throw new UnauthorizedException('Ikkinchi kod noto‘g‘ri');
    }

    const target = await this.usersService.findById(dto.targetUserId);

    if (!target || !target.isActive) {
      throw new UnauthorizedException('Foydalanuvchi topilmadi yoki nofaol');
    }

    return this.completeLogin(
      target,
      deviceMeta,
      req,
      SessionEventType.OVERRIDE_LOGIN,
      actorId,
    );
  }

  async getGlobalSecondCodeStatus(actorRole: UserRole) {
    if (!isSuperAdminRole(actorRole)) {
      throw new ForbiddenException('Ushbu amal uchun ruxsat yo‘q');
    }

    return {
      isConfigured: await this.globalSecondCodeService.hasCode(),
    };
  }

  async setGlobalSecondCode(actorRole: UserRole, dto: SetGlobalSecondCodeDto) {
    if (!isSuperAdminRole(actorRole)) {
      throw new ForbiddenException('Ushbu amal uchun ruxsat yo‘q');
    }

    if (dto.code.trim() !== dto.codeConfirm.trim()) {
      throw new BadRequestException('Ikkinchi kodlar mos kelmadi');
    }

    try {
      await this.globalSecondCodeService.updateCode(dto.code);
    } catch {
      throw new BadRequestException(
        'Ikkinchi kod kamida 4 belgidan iborat bo‘lishi kerak',
      );
    }

    return { success: true };
  }

  private async enrichAuthProfile(
    profile: ReturnType<UsersService['getAuthProfile']>,
    userId: string,
    deviceMeta?: DeviceMeta,
  ) {
    if (deviceMeta?.deviceId) {
      await this.userDevicesService.registerDevice(userId, deviceMeta);
    }

    const isUserOnline = this.realtimeGateway.isUserOnline(userId);
    const onlineDeviceIds = this.realtimeGateway.getOnlineDeviceIds(userId);
    const activeDevices = await this.userDevicesService.listDevices(userId, {
      currentDeviceId: deviceMeta?.deviceId,
      onlineDeviceIds,
      isUserOnline,
      currentDeviceMeta: deviceMeta,
    });

    return {
      ...profile,
      isOnline: isUserOnline,
      activeDevices,
      activeDeviceCount: activeDevices.filter((device) => device.isOnline).length,
    };
  }
}
