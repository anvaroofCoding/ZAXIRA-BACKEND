import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type WarehouseImportSessionItemEmbeddable = {
  name: string;
  characteristics: string;
  quantity: number;
  unit: string;
  manufacturingCountry: string;
};

@Schema({ _id: false })
export class WarehouseImportSessionItemSchemaClass {
  @Prop({ trim: true, default: '' })
  name!: string;

  @Prop({ trim: true, default: '' })
  characteristics!: string;

  @Prop({ min: 1, default: 1 })
  quantity!: number;

  @Prop({ trim: true, default: 'dona' })
  unit!: string;

  @Prop({ trim: true, default: '' })
  manufacturingCountry!: string;
}

export const WarehouseImportSessionItemSchema = SchemaFactory.createForClass(
  WarehouseImportSessionItemSchemaClass,
);

export type WarehouseImportSessionDocument =
  HydratedDocument<WarehouseImportSession>;

@Schema({
  timestamps: true,
  collection: 'warehouse_import_sessions',
})
export class WarehouseImportSession {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'WarehouseLocation' })
  locationId?: Types.ObjectId;

  @Prop({ trim: true, default: '' })
  title!: string;

  @Prop({ type: [WarehouseImportSessionItemSchema], default: [] })
  items!: WarehouseImportSessionItemSchemaClass[];

  @Prop({ trim: true, default: '' })
  comment!: string;

  updatedAt?: Date;
  createdAt?: Date;
}

export const WarehouseImportSessionSchema = SchemaFactory.createForClass(
  WarehouseImportSession,
);

WarehouseImportSessionSchema.index({ userId: 1, updatedAt: -1 });
