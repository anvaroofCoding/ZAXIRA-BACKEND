import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  forwardRef,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationsEventsService } from '../notifications/notifications-events.service';
import { UsersService } from '../users/users.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { DeviceMeta, UserDevicesService } from './user-devices.service';

@Injectable()
export class AuthService {
  private static readonly MAX_FAILED_LOGIN_ATTEMPTS = 5;
  private static readonly LOCK_DURATION_MS = 30 * 1000;

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly userDevicesService: UserDevicesService,
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

  private getRemainingSeconds(lockUntil: Date): number {
    return Math.max(0, Math.ceil((lockUntil.getTime() - Date.now()) / 1000));
  }

  async login(dto: LoginDto, deviceMeta: DeviceMeta) {
    const user = await this.usersService.findByLoginWithPassword(dto.login);

    if (!user) {
      throw new UnauthorizedException('Login yoki parol noto‘g‘ri');
    }

    if (user.lockUntil && user.lockUntil.getTime() > Date.now()) {
      const remainingSeconds = this.getRemainingSeconds(user.lockUntil);
      throw new ForbiddenException({
        message: 'Profil vaqtincha bloklangan. Keyinroq qayta urinib ko‘ring',
        lockUntil: user.lockUntil.toISOString(),
        remainingSeconds,
      });
    }

    const isValid = await this.usersService.validatePassword(
      dto.password,
      user.passwordHash,
    );

    if (!isValid) {
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

    return {
      accessToken,
      user: await this.enrichAuthProfile(
        this.usersService.getAuthProfile(profileUser ?? user),
        user.id,
        deviceMeta,
      ),
    };
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
