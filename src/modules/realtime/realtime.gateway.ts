import { Inject, Logger, UnauthorizedException, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { UserRole } from '../../common/enums/user-role.enum';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { UserDevicesService } from '../auth/user-devices.service';
import { UserSessionEventsService } from '../auth/user-session-events.service';
import { SessionEventType } from '../auth/enums/session-event-type.enum';
import { UsersService } from '../users/users.service';

@WebSocketGateway({
  namespace: '/realtime',
  cors: {
    origin: true,
    credentials: true,
  },
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly connectionCounts = new Map<string, number>();
  private readonly deviceConnectionCounts = new Map<string, number>();

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    @Inject(forwardRef(() => UserDevicesService))
    private readonly userDevicesService: UserDevicesService,
    @Inject(forwardRef(() => UserSessionEventsService))
    private readonly userSessionEventsService: UserSessionEventsService,
  ) {}

  isUserOnline(userId: string): boolean {
    return (this.connectionCounts.get(userId) ?? 0) > 0;
  }

  getOnlineDeviceIds(userId: string): string[] {
    const prefix = `${userId}:`;
    const deviceIds: string[] = [];

    for (const [key, count] of this.deviceConnectionCounts.entries()) {
      if (key.startsWith(prefix) && count > 0) {
        deviceIds.push(key.slice(prefix.length));
      }
    }

    return deviceIds;
  }

  private buildDeviceKey(userId: string, deviceId: string): string {
    return `${userId}:${deviceId}`;
  }

  private readDeviceId(client: Socket): string {
    const deviceId = client.handshake.auth?.deviceId;

    if (typeof deviceId === 'string' && deviceId.trim()) {
      return deviceId.trim();
    }

    return '';
  }

  private readDeviceName(client: Socket): string {
    const deviceName = client.handshake.auth?.deviceName;

    if (typeof deviceName === 'string' && deviceName.trim()) {
      return deviceName.trim();
    }

    return '';
  }

  private readUserAgent(client: Socket): string {
    const userAgent = client.handshake.headers['user-agent'];

    return typeof userAgent === 'string' ? userAgent.trim() : '';
  }

  private readSocketIp(client: Socket): string {
    const forwarded = client.handshake.headers['x-forwarded-for'];

    if (typeof forwarded === 'string' && forwarded.trim()) {
      return forwarded.split(',')[0]?.trim() || '';
    }

    const address = client.handshake.address;
    return typeof address === 'string' ? address.trim() : '';
  }

  async handleConnection(client: Socket) {
    try {
      const token = this.extractToken(client);
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.configService.getOrThrow<string>('jwt.secret'),
      });

      const user = await this.usersService.findById(payload.sub);

      if (!user?.isActive) {
        throw new UnauthorizedException();
      }

      await client.join(`user:${user.id}`);
      await client.join('chat:global');

      if (user.role === UserRole.SUPER_ADMIN) {
        await client.join('role:super-admin');
      }

      const userId = user.id;
      const deviceId = this.readDeviceId(client);
      const deviceName = this.readDeviceName(client);
      const userAgent = this.readUserAgent(client);
      const ipAddress = this.readSocketIp(client);

      client.data.userId = userId;
      client.data.role = user.role;
      client.data.deviceId = deviceId;
      client.data.deviceName = deviceName;
      client.data.userAgent = userAgent;
      client.data.ipAddress = ipAddress;

      const prev = this.connectionCounts.get(userId) ?? 0;
      this.connectionCounts.set(userId, prev + 1);

      if (deviceId) {
        const deviceKey = this.buildDeviceKey(userId, deviceId);
        const prevDevice = this.deviceConnectionCounts.get(deviceKey) ?? 0;
        this.deviceConnectionCounts.set(deviceKey, prevDevice + 1);

        try {
          await this.userDevicesService.registerDevice(userId, {
            deviceId,
            deviceName,
            userAgent,
          });
        } catch (error) {
          this.logger.warn(
            `Qurilma ro‘yxatdan o‘tkazilmadi (${userId}): ${String(error)}`,
          );
        }
      }

      try {
        await this.userSessionEventsService.recordDailyOnlineEvent(userId, {
          deviceId,
          deviceName,
          userAgent,
          ipAddress,
        });
      } catch (error) {
        this.logger.warn(
          `Kunlik onlayn yozilmadi (${userId}): ${String(error)}`,
        );
      }
    } catch {
      this.logger.warn(`WebSocket rad etildi: ${client.id}`);
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket) {
    const userId = client.data.userId as string | undefined;
    const deviceId = client.data.deviceId as string | undefined;
    const deviceName = client.data.deviceName as string | undefined;
    const userAgent = client.data.userAgent as string | undefined;
    const ipAddress = client.data.ipAddress as string | undefined;

    if (userId) {
      const prev = this.connectionCounts.get(userId) ?? 1;
      const next = prev - 1;

      if (next <= 0) {
        this.connectionCounts.delete(userId);
        try {
          await this.usersService.updateLastOnline(userId);
          await this.userSessionEventsService.recordEvent(
            userId,
            SessionEventType.OFFLINE,
            {
              deviceId: deviceId || '',
              deviceName: deviceName || '',
              userAgent: userAgent || '',
              ipAddress: ipAddress || '',
            },
          );
        } catch (error) {
          this.logger.warn(
            `lastOnline yangilab bo‘lmadi (${userId}): ${String(error)}`,
          );
        }
      } else {
        this.connectionCounts.set(userId, next);
      }
    }

    if (userId && deviceId) {
      const deviceKey = this.buildDeviceKey(userId, deviceId);
      const prevDevice = this.deviceConnectionCounts.get(deviceKey) ?? 1;
      const nextDevice = prevDevice - 1;

      if (nextDevice <= 0) {
        this.deviceConnectionCounts.delete(deviceKey);
      } else {
        this.deviceConnectionCounts.set(deviceKey, nextDevice);
      }
    }

    this.logger.debug(`WebSocket uzildi: ${client.id}`);
  }

  private extractToken(client: Socket): string {
    const authToken = client.handshake.auth?.token;

    if (typeof authToken === 'string' && authToken.trim()) {
      return authToken.trim();
    }

    const authorization = client.handshake.headers.authorization;

    if (
      typeof authorization === 'string' &&
      authorization.startsWith('Bearer ')
    ) {
      return authorization.slice(7).trim();
    }

    throw new UnauthorizedException('Token topilmadi');
  }
}
