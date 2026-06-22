import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  UserDeviceSession,
  UserDeviceSessionDocument,
} from './schemas/user-device-session.schema';
import { DeviceTelemetry } from './types/device-telemetry.type';

const ACTIVE_DEVICE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export interface DeviceMeta {
  deviceId?: string;
  deviceName?: string;
  userAgent?: string;
  telemetry?: DeviceTelemetry;
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
    const update: Record<string, unknown> = {
      deviceName: meta.deviceName?.trim() || 'Noma’lum qurilma',
      userAgent: meta.userAgent?.trim() || '',
      lastActiveAt: now,
    };

    if (meta.telemetry) {
      update.telemetry = this.sanitizeTelemetry(meta.telemetry);
      update.telemetryUpdatedAt = now;
    }

    await this.userDeviceSessionModel
      .findOneAndUpdate(
        {
          userId: new Types.ObjectId(userId),
          deviceId,
        },
        {
          $set: update,
        },
        {
          upsert: true,
          returnDocument: 'after',
          setDefaultsOnInsert: true,
        },
      )
      .exec();
  }

  async updateDeviceTelemetry(
    userId: string,
    meta: DeviceMeta,
    telemetry: DeviceTelemetry,
  ) {
    const deviceId = meta.deviceId?.trim();
    if (!deviceId) {
      return null;
    }

    const now = new Date();
    const sanitized = this.sanitizeTelemetry(telemetry);

    const session = await this.userDeviceSessionModel
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
            telemetry: sanitized,
            telemetryUpdatedAt: now,
          },
        },
        {
          upsert: true,
          returnDocument: 'after',
          setDefaultsOnInsert: true,
        },
      )
      .exec();

    return session;
  }

  async getLastDeviceWithTelemetry(userId: string) {
    const session = await this.userDeviceSessionModel
      .findOne({
        userId: new Types.ObjectId(userId),
      })
      .sort({ lastActiveAt: -1 })
      .lean()
      .exec();

    if (!session) {
      return null;
    }

    return {
      deviceId: session.deviceId,
      deviceName: session.deviceName?.trim() || 'Noma’lum qurilma',
      userAgent: session.userAgent ?? '',
      lastActiveAt: session.lastActiveAt ?? session.updatedAt ?? null,
      telemetryUpdatedAt: session.telemetryUpdatedAt ?? null,
      telemetry: session.telemetry ?? null,
    };
  }

  private sanitizeTelemetry(input: DeviceTelemetry): DeviceTelemetry {
    const toNumber = (value: unknown) => {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
      return null;
    };

    const toString = (value: unknown) => {
      if (typeof value === 'string' && value.trim()) {
        return value.trim().slice(0, 500);
      }
      return null;
    };

    return {
      ramGb: toNumber(input.ramGb),
      cpuCores: toNumber(input.cpuCores),
      processor: toString(input.processor),
      processorModel: toString(input.processorModel),
      processorArchitecture: toString(input.processorArchitecture),
      processorPlatform: toString(input.processorPlatform),
      networkType: toString(input.networkType),
      networkDownlinkMbps: toNumber(input.networkDownlinkMbps),
      networkRttMs: toNumber(input.networkRttMs),
      memoryUsedPercent: toNumber(input.memoryUsedPercent),
      jsHeapUsedMb: toNumber(input.jsHeapUsedMb),
      jsHeapLimitMb: toNumber(input.jsHeapLimitMb),
      storageUsedMb: toNumber(input.storageUsedMb),
      storageQuotaMb: toNumber(input.storageQuotaMb),
      storageUsedPercent: toNumber(input.storageUsedPercent),
      screenWidth: toNumber(input.screenWidth),
      screenHeight: toNumber(input.screenHeight),
      devicePixelRatio: toNumber(input.devicePixelRatio),
      language: toString(input.language),
      timezone: toString(input.timezone),
      collectedAt: toString(input.collectedAt),
    };
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

  async findDeviceMeta(
    userId: string,
    deviceId: string,
  ): Promise<DeviceMeta | null> {
    const normalizedId = deviceId.trim();
    if (!normalizedId) {
      return null;
    }

    const session = await this.userDeviceSessionModel
      .findOne({
        userId: new Types.ObjectId(userId),
        deviceId: normalizedId,
      })
      .lean()
      .exec();

    if (!session) {
      return null;
    }

    return {
      deviceId: session.deviceId,
      deviceName: session.deviceName?.trim() || 'Noma’lum qurilma',
      userAgent: session.userAgent?.trim() || '',
    };
  }
}
