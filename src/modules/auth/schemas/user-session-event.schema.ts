import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { SessionEventType } from '../enums/session-event-type.enum';

export type UserSessionEventDocument = HydratedDocument<UserSessionEvent>;

@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'user_session_events',
})
export class UserSessionEvent {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: String, enum: SessionEventType, required: true, index: true })
  eventType!: SessionEventType;

  @Prop({ trim: true, default: '' })
  deviceId!: string;

  @Prop({ trim: true, default: '' })
  deviceName!: string;

  @Prop({ trim: true, default: '' })
  userAgent!: string;

  @Prop({ trim: true, default: '' })
  ipAddress!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  actorUserId?: Types.ObjectId | null;

  createdAt?: Date;
}

export const UserSessionEventSchema =
  SchemaFactory.createForClass(UserSessionEvent);

UserSessionEventSchema.index({ userId: 1, createdAt: -1 });
