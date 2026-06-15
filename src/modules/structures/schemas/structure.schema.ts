import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type StructureDocument = HydratedDocument<Structure>;

@Schema({
  timestamps: true,
  collection: 'structures',
})
export class Structure {
  @Prop({ required: true, trim: true })
  fullName!: string;

  @Prop({ required: true, trim: true, uppercase: true })
  shortName!: string;

  @Prop({ default: true })
  isActive!: boolean;

  @Prop({ default: false })
  hasWarehouse!: boolean;

  @Prop({ default: false })
  hasLeader!: boolean;

  @Prop({ trim: true, default: '' })
  leaderName!: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export const StructureSchema = SchemaFactory.createForClass(Structure);

StructureSchema.index({ shortName: 1 }, { unique: true });
StructureSchema.index({ isActive: 1, fullName: 1 });
