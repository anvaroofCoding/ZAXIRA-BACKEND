import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type WarehouseInventoryDocument = HydratedDocument<WarehouseInventory>;

@Schema({
  timestamps: true,
  collection: 'warehouse_inventory',
})
export class WarehouseInventory {
  @Prop({ type: Types.ObjectId, ref: 'Structure', required: true, index: true })
  structureId!: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'WarehouseLocation',
    required: true,
    index: true,
  })
  locationId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  itemKey!: string;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, trim: true })
  characteristics!: string;

  @Prop({ trim: true, index: true })
  barcode?: string;

  @Prop({ required: true, min: 0, default: 0 })
  quantity!: number;

  @Prop()
  lastReceiptAt?: Date;

  createdAt?: Date;
  updatedAt?: Date;
}

export const WarehouseInventorySchema =
  SchemaFactory.createForClass(WarehouseInventory);

WarehouseInventorySchema.index(
  { structureId: 1, locationId: 1, itemKey: 1 },
  { unique: true },
);

WarehouseInventorySchema.index(
  { locationId: 1, barcode: 1 },
  { unique: true, sparse: true },
);

