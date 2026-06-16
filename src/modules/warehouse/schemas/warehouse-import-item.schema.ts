import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

@Schema({ _id: false })
export class WarehouseImportItemEmbeddable {
  @Prop({ type: Types.ObjectId, ref: 'WarehouseLocation', required: true })
  locationId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, trim: true })
  characteristics!: string;

  @Prop({ required: true, min: 1 })
  quantity!: number;

  @Prop({ trim: true, default: '' })
  unit!: string;

  @Prop({ trim: true, default: '' })
  manufacturingCountry!: string;

  @Prop({ required: true, trim: true })
  itemKey!: string;
}

export const WarehouseImportItemSchema = SchemaFactory.createForClass(
  WarehouseImportItemEmbeddable,
);
