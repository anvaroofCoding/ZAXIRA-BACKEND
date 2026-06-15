import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type UserDeviceSessionDocument = HydratedDocument<UserDeviceSession>;

@Schema({
  timestamps: true,
  collection: 'user_device_sessions',
})
export class UserDeviceSession {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  deviceId!: string;

  @Prop({ trim: true, default: '' })
  deviceName!: string;

  @Prop({ trim: true, default: '' })
  userAgent!: string;

  @Prop({ type: Date, default: () => new Date() })
  lastActiveAt!: Date;

  updatedAt?: Date;
  createdAt?: Date;
}

export const UserDeviceSessionSchema =
  SchemaFactory.createForClass(UserDeviceSession);

UserDeviceSessionSchema.index({ userId: 1, deviceId: 1 }, { unique: true });
UserDeviceSessionSchema.index({ userId: 1, lastActiveAt: -1 });
