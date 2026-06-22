import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { SessionEventType } from './enums/session-event-type.enum';
import {
  UserSessionEvent,
  UserSessionEventDocument,
} from './schemas/user-session-event.schema';
import { DeviceMeta, UserDevicesService } from './user-devices.service';

export interface SessionEventMeta extends DeviceMeta {
  ipAddress?: string;
  actorUserId?: string;
}

@Injectable()
export class UserSessionEventsService {
  constructor(
    @InjectModel(UserSessionEvent.name)
    private readonly eventModel: Model<UserSessionEventDocument>,
    private readonly userDevicesService: UserDevicesService,
  ) {}

  private getStartOfToday(): Date {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return start;
  }

  async recordEvent(
    userId: string,
    eventType: SessionEventType,
    meta?: SessionEventMeta,
  ): Promise<void> {
    const enriched = await this.enrichMeta(userId, meta);

    await this.eventModel.create({
      userId: new Types.ObjectId(userId),
      eventType,
      deviceId: enriched.deviceId,
      deviceName: enriched.deviceName,
      userAgent: enriched.userAgent,
      ipAddress: enriched.ipAddress,
      actorUserId: meta?.actorUserId
        ? new Types.ObjectId(meta.actorUserId)
        : null,
    });
  }

  async recordDailyOnlineEvent(
    userId: string,
    meta?: SessionEventMeta,
  ): Promise<void> {
    const startOfToday = this.getStartOfToday();
    const existing = await this.eventModel.exists({
      userId: new Types.ObjectId(userId),
      eventType: SessionEventType.ONLINE,
      createdAt: { $gte: startOfToday },
    });

    if (existing) {
      return;
    }

    await this.recordEvent(userId, SessionEventType.ONLINE, meta);
  }

  private async enrichMeta(
    userId: string,
    meta?: SessionEventMeta,
  ): Promise<{
    deviceId: string;
    deviceName: string;
    userAgent: string;
    ipAddress: string;
  }> {
    const deviceId = meta?.deviceId?.trim() || '';
    let deviceName = meta?.deviceName?.trim() || '';
    let userAgent = meta?.userAgent?.trim() || '';

    if (deviceId && (!deviceName || !userAgent)) {
      const stored = await this.userDevicesService.findDeviceMeta(
        userId,
        deviceId,
      );
      if (stored) {
        deviceName = deviceName || stored.deviceName?.trim() || '';
        userAgent = userAgent || stored.userAgent?.trim() || '';
      }
    }

    return {
      deviceId,
      deviceName: deviceName || (deviceId ? 'Noma’lum qurilma' : ''),
      userAgent,
      ipAddress: meta?.ipAddress?.trim() || '',
    };
  }

  async findByUserPaginated(
    userId: string,
    page = 1,
    limit = 50,
  ): Promise<{
    items: Array<{
      id: string;
      eventType: SessionEventType;
      deviceId: string;
      deviceName: string;
      userAgent: string;
      ipAddress: string;
      actor: {
        id: string;
        displayName: string;
        login: string;
      } | null;
      createdAt: Date;
    }>;
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(100, Math.max(1, limit));
    const skip = (safePage - 1) * safeLimit;
    const filter = { userId: new Types.ObjectId(userId) };

    const [events, total] = await Promise.all([
      this.eventModel
        .find(filter)
        .populate({
          path: 'actorUserId',
          select: 'displayName login',
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(safeLimit)
        .exec(),
      this.eventModel.countDocuments(filter).exec(),
    ]);

    const items = await Promise.all(
      events.map(async (event) => {
        const actorRef = event.actorUserId as
          | { _id: Types.ObjectId; displayName: string; login: string }
          | Types.ObjectId
          | null
          | undefined;

        const actor =
          actorRef &&
          typeof actorRef === 'object' &&
          'login' in actorRef
            ? {
                id: String(actorRef._id),
                displayName: actorRef.displayName || actorRef.login,
                login: actorRef.login,
              }
            : null;

        const enriched = await this.enrichMeta(userId, {
          deviceId: event.deviceId,
          deviceName: event.deviceName,
          userAgent: event.userAgent,
          ipAddress: event.ipAddress,
        });

        return {
          id: event.id,
          eventType: event.eventType,
          deviceId: enriched.deviceId,
          deviceName: enriched.deviceName,
          userAgent: enriched.userAgent,
          ipAddress: enriched.ipAddress,
          actor,
          createdAt: event.createdAt!,
        };
      }),
    );

    return {
      items,
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.max(1, Math.ceil(total / safeLimit)),
    };
  }
}
