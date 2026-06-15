import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

@Schema({ _id: false })
export class UserSnapshotEmbeddable {
  @Prop({ type: Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  displayName!: string;

  @Prop({ required: true, trim: true, lowercase: true })
  login!: string;

  /** Tuzilma qisqa nomi (snapshot) */
  @Prop({ trim: true })
  structureShortName?: string;

  /** Tuzilma ro‘yxatidagi raxbar F.I.O. (hujjatlar uchun) */
  @Prop({ trim: true })
  structureLeaderName?: string;

  @Prop({ trim: true })
  position?: string;
}

export const UserSnapshotSchema = SchemaFactory.createForClass(
  UserSnapshotEmbeddable,
);
