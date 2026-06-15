import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type WarehouseLocationDocument = HydratedDocument<WarehouseLocation>;

@Schema({
  timestamps: true,
  collection: 'warehouse_locations',
})
export class WarehouseLocation {
  @Prop({ type: Types.ObjectId, ref: 'Structure', required: true, index: true })
  structureId!: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 80 })
  name!: string;

  @Prop({ default: true, index: true })
  isActive!: boolean;

  createdAt?: Date;
  updatedAt?: Date;
}

export const WarehouseLocationSchema =
  SchemaFactory.createForClass(WarehouseLocation);

WarehouseLocationSchema.index({ structureId: 1, name: 1 }, { unique: true });
