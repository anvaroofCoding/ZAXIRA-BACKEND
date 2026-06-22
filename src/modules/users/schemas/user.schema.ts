import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { UserRole } from '../../../common/enums/user-role.enum';

export type UserDocument = HydratedDocument<User>;

@Schema({
  timestamps: true,
  collection: 'users',
})
export class User {
  @Prop({
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
  })
  login!: string;

  @Prop({ required: true, select: false })
  passwordHash!: string;

  @Prop({ type: String, select: false, default: null })
  secondCodeHash?: string | null;

  @Prop({ type: String, index: true, sparse: true, unique: true, default: null })
  secondCodeLookup?: string | null;

  @Prop({ trim: true, default: '' })
  displayName!: string;

  @Prop({ trim: true, default: '' })
  position!: string;

  @Prop({
    type: String,
    enum: UserRole,
    default: UserRole.USER,
    index: true,
  })
  role!: UserRole;

  @Prop({ default: true, index: true })
  isActive!: boolean;

  @Prop({ default: 0 })
  failedLoginAttempts!: number;

  @Prop({ type: Date, default: null })
  lockUntil?: Date | null;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  permissions!: Record<string, unknown>;

  @Prop({ type: Types.ObjectId, ref: 'Structure', index: true })
  structureId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  createdBy?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  deactivatedBy?: Types.ObjectId;

  @Prop({ type: Date, default: null })
  deactivatedAt?: Date | null;

  @Prop({ type: Date, default: null })
  lastOnline?: Date | null;

  @Prop({ type: Date, default: null })
  lastLoginAt?: Date | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);

UserSchema.index({ role: 1, isActive: 1 });
UserSchema.index({ structureId: 1, isActive: 1 });
