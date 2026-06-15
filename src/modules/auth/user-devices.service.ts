import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  UserDeviceSession,
  UserDeviceSessionDocument,
} from './schemas/user-device-session.schema';

const ACTIVE_DEVICE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export interface DeviceMeta {
  deviceId?: string;
  deviceName?: string;
  userAgent?: string;
}

export interface ActiveDeviceView {
  deviceId: string;
  deviceName: string;
  isCurrent: boolean;
  isOnline: boolean;
  lastActiveAt: Date | null;
}

@Injectable()
export class UserDevicesService {
  constructor(
    @InjectModel(UserDeviceSession.name)
    private readonly userDeviceSessionModel: Model<UserDeviceSessionDocument>,
  ) {}

  async registerDevice(userId: string, meta: DeviceMeta) {
    const deviceId = meta.deviceId?.trim();
    if (!deviceId) {
      return;
    }

    const now = new Date();

    await this.userDeviceSessionModel
      .findOneAndUpdate(
        {
          userId: new Types.ObjectId(userId),
          deviceId,
        },
        {
          $set: {
            deviceName: meta.deviceName?.trim() || 'Noma’lum qurilma',
            userAgent: meta.userAgent?.trim() || '',
            lastActiveAt: now,
          },
        },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true,
        },
      )
      .exec();
  }

  buildCurrentDeviceFallback(
    meta: DeviceMeta,
    options: {
      isOnline: boolean;
    },
  ): ActiveDeviceView | null {
    const deviceId = meta.deviceId?.trim();
    if (!deviceId) {
      return null;
    }

    return {
      deviceId,
      deviceName: meta.deviceName?.trim() || 'Noma’lum qurilma',
      isCurrent: true,
      isOnline: options.isOnline,
      lastActiveAt: new Date(),
    };
  }

  async listDevices(
    userId: string,
    options: {
      currentDeviceId?: string;
      onlineDeviceIds: string[];
      isUserOnline?: boolean;
      currentDeviceMeta?: DeviceMeta;
    },
  ): Promise<ActiveDeviceView[]> {
    const cutoff = new Date(Date.now() - ACTIVE_DEVICE_WINDOW_MS);
    const sessions = await this.userDeviceSessionModel
      .find({
        userId: new Types.ObjectId(userId),
        lastActiveAt: { $gte: cutoff },
      })
      .sort({ lastActiveAt: -1 })
      .lean()
      .exec();

    const onlineSet = new Set(options.onlineDeviceIds);
    const currentDeviceId =
      options.currentDeviceId?.trim() ||
      options.currentDeviceMeta?.deviceId?.trim() ||
      '';
    const hasTrackedOnlineDevices = onlineSet.size > 0;

    const devices: ActiveDeviceView[] = sessions
      .map((session) => ({
        deviceId: session.deviceId,
        deviceName: session.deviceName?.trim() || 'Noma’lum qurilma',
        isCurrent: session.deviceId === currentDeviceId,
        isOnline:
          onlineSet.has(session.deviceId) ||
          (session.deviceId === currentDeviceId &&
            !hasTrackedOnlineDevices &&
            Boolean(options.isUserOnline)),
        lastActiveAt: session.lastActiveAt ?? session.updatedAt ?? null,
      }))
      .filter((device) => device.isOnline || device.isCurrent);

    if (
      currentDeviceId &&
      !devices.some((device) => device.deviceId === currentDeviceId) &&
      options.currentDeviceMeta
    ) {
      const fallback = this.buildCurrentDeviceFallback(
        options.currentDeviceMeta,
        {
          isOnline:
            onlineSet.has(currentDeviceId) || Boolean(options.isUserOnline),
        },
      );

      if (fallback) {
        devices.unshift(fallback);
      }
    }

    return devices;
  }
}
