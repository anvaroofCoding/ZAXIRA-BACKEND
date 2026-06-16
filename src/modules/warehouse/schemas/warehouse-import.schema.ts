import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  WarehouseImportItemEmbeddable,
  WarehouseImportItemSchema,
} from './warehouse-import-item.schema';

export type WarehouseImportDocument = HydratedDocument<WarehouseImport>;

@Schema({
  timestamps: true,
  collection: 'warehouse_imports',
})
export class WarehouseImport {
  @Prop({ type: Types.ObjectId, ref: 'Structure', required: true, index: true })
  structureId!: Types.ObjectId;

  @Prop({ required: true, trim: true, index: true })
  code!: string;

  @Prop({ type: [WarehouseImportItemSchema], default: [] })
  items!: WarehouseImportItemEmbeddable[];

  @Prop({ trim: true, default: '' })
  comment!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;

  createdAt?: Date;
  updatedAt?: Date;
}

export const WarehouseImportSchema =
  SchemaFactory.createForClass(WarehouseImport);

WarehouseImportSchema.index({ structureId: 1, createdAt: -1 });
WarehouseImportSchema.index({ 'items.locationId': 1, 'items.itemKey': 1 });
