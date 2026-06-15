import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import {
  UserSnapshotEmbeddable,
  UserSnapshotSchema,
} from '../../purchase-requests/schemas/user-snapshot.schema';

export type CommissionDocument = HydratedDocument<Commission>;

@Schema({
  timestamps: true,
  collection: 'commissions',
})
export class Commission {
  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ type: [UserSnapshotSchema], required: true })
  members!: UserSnapshotEmbeddable[];

  @Prop({ type: UserSnapshotSchema })
  boss?: UserSnapshotEmbeddable;

  @Prop({ default: true })
  isActive!: boolean;

  createdAt?: Date;
  updatedAt?: Date;
}

export const CommissionSchema = SchemaFactory.createForClass(Commission);

CommissionSchema.index({ isActive: 1, name: 1 });
CommissionSchema.index({ name: 1 }, { unique: true });
