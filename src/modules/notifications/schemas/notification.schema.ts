import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { NotificationType } from '../enums/notification-type.enum';

export type NotificationDocument = HydratedDocument<Notification>;

@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'notifications',
})
export class Notification {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: String, enum: NotificationType, required: true })
  type!: NotificationType;

  @Prop({ type: String, required: true, trim: true })
  title!: string;

  @Prop({ type: String, required: true, trim: true })
  message!: string;

  @Prop({ type: String, required: true, trim: true })
  linkPath!: string;

  @Prop({ type: String, trim: true, default: '' })
  entityId!: string;

  @Prop({ type: Boolean, default: false, index: true })
  isRead!: boolean;

  createdAt?: Date;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);

NotificationSchema.index({ userId: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, isRead: 1 });
