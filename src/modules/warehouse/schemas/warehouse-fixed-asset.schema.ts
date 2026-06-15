import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type WarehouseFixedAssetDocument = HydratedDocument<WarehouseFixedAsset>;

export const WAREHOUSE_FIXED_ASSET_STATUSES = [
  'active',
  'returned',
  'discarded',
] as const;

export type WarehouseFixedAssetStatus =
  (typeof WAREHOUSE_FIXED_ASSET_STATUSES)[number];

@Schema({
  timestamps: true,
  collection: 'warehouse_fixed_assets',
})
export class WarehouseFixedAsset {
  @Prop({ type: Types.ObjectId, ref: 'Structure', required: true, index: true })
  structureId!: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'WarehouseLocation',
    required: true,
    index: true,
  })
  locationId!: Types.ObjectId;

  @Prop({ required: true, trim: true, index: true })
  expenseCode!: string;

  @Prop({ type: Types.ObjectId, ref: 'Structure', required: true, index: true })
  serviceStructureId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  serviceStructureName!: string;

  @Prop({ required: true, trim: true })
  itemKey!: string;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, trim: true })
  characteristics!: string;

  @Prop({ required: true, trim: true })
  barcode!: string;

  @Prop({ trim: true, default: '' })
  nomenclatureCode?: string;

  @Prop({ required: true, min: 1 })
  quantity!: number;

  @Prop({
    required: true,
    enum: WAREHOUSE_FIXED_ASSET_STATUSES,
    default: 'active',
    index: true,
  })
  status!: WarehouseFixedAssetStatus;

  @Prop({ trim: true, default: '' })
  comment!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  createdBy!: Types.ObjectId;

  @Prop({ type: Date, default: null })
  returnedAt?: Date | null;

  @Prop({ type: Date, default: null })
  discardedAt?: Date | null;

  @Prop({ trim: true, default: '' })
  discardReason?: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export const WarehouseFixedAssetSchema =
  SchemaFactory.createForClass(WarehouseFixedAsset);

WarehouseFixedAssetSchema.index({ structureId: 1, status: 1, createdAt: -1 });
WarehouseFixedAssetSchema.index({ structureId: 1, expenseCode: 1 });
