import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationType } from './enums/notification-type.enum';
import { QueryNotificationsDto } from './dto/query-notifications.dto';
import {
  Notification,
  NotificationDocument,
} from './schemas/notification.schema';

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  linkPath: string;
  entityId?: string;
}

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,
    private readonly realtimeGateway: RealtimeGateway,
  ) {}

  private toPublic(doc: NotificationDocument) {
    return {
      id: doc.id,
      type: doc.type,
      title: doc.title,
      message: doc.message,
      linkPath: doc.linkPath,
      entityId: doc.entityId || '',
      isRead: doc.isRead,
      createdAt: doc.createdAt,
    };
  }

  async createMany(inputs: CreateNotificationInput[]) {
    if (!inputs.length) {
      return [];
    }

    const docs = await this.notificationModel.insertMany(
      inputs.map((input) => ({
        userId: new Types.ObjectId(input.userId),
        type: input.type,
        title: input.title,
        message: input.message,
        linkPath: input.linkPath,
        entityId: input.entityId ?? '',
        isRead: false,
      })),
    );

    const server = this.realtimeGateway.server;

    if (server) {
      for (const doc of docs) {
        const payload = this.toPublic(doc);
        server
          .to(`user:${String(doc.userId)}`)
          .emit('notification:created', payload);
      }
    }

    return docs.map((doc) => this.toPublic(doc));
  }

  async findPaginated(userId: string, query: QueryNotificationsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const filter = { userId: new Types.ObjectId(userId) };

    const [items, total] = await Promise.all([
      this.notificationModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.notificationModel.countDocuments(filter).exec(),
    ]);

    return {
      items: items.map((item) => this.toPublic(item)),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async countUnread(userId: string) {
    return this.notificationModel
      .countDocuments({
        userId: new Types.ObjectId(userId),
        isRead: false,
      })
      .exec();
  }

  async markAsRead(id: string, userId: string) {
    const notification = await this.notificationModel
      .findOne({
        _id: new Types.ObjectId(id),
        userId: new Types.ObjectId(userId),
      })
      .exec();

    if (!notification) {
      throw new NotFoundException('Bildirishnoma topilmadi');
    }

    if (!notification.isRead) {
      notification.isRead = true;
      await notification.save();
    }

    return this.toPublic(notification);
  }
}
