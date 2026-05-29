import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type WarehouseExpenseDocument = HydratedDocument<WarehouseExpense>;

@Schema({ _id: false })
export class WarehouseExpenseItem {
  @Prop({ required: true, trim: true })
  itemKey!: string;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, trim: true })
  characteristics!: string;

  @Prop({ required: true, trim: true })
  barcode!: string;

  @Prop({ required: true, min: 1 })
  quantity!: number;
}

export const WarehouseExpenseItemSchema =
  SchemaFactory.createForClass(WarehouseExpenseItem);

@Schema({
  timestamps: true,
  collection: 'warehouse_expenses',
})
export class WarehouseExpense {
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
  code!: string;

  @Prop({ required: true, trim: true, index: true })
  reasonKey!: string;

  @Prop({ required: true, trim: true })
  reasonLabel!: string;

  @Prop({ trim: true, default: '' })
  comment!: string;

  @Prop({ type: [WarehouseExpenseItemSchema], default: [] })
  items!: WarehouseExpenseItem[];

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  createdBy!: Types.ObjectId;

  createdAt?: Date;
  updatedAt?: Date;
}

export const WarehouseExpenseSchema =
  SchemaFactory.createForClass(WarehouseExpense);

WarehouseExpenseSchema.index({ structureId: 1, createdAt: -1 });

