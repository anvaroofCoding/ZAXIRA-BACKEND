import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

@Schema({ _id: false })
export class DispatchItemEmbeddable {
  @Prop({ required: true, min: 0 })
  itemIndex!: number;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, trim: true })
  characteristics!: string;

  @Prop({ required: true, min: 1 })
  quantityDispatched!: number;

  @Prop({ required: true, min: 0, default: 0 })
  quantityReceived!: number;

  @Prop({ required: true, min: 0, default: 0 })
  quantityRejected!: number;

  @Prop({ trim: true, default: '' })
  rejectReason!: string;

  @Prop({ type: Types.ObjectId, ref: 'WarehouseLocation', required: false })
  sourceLocationId?: Types.ObjectId;

  @Prop({ trim: true, required: false })
  sourceBarcode?: string;
}

export const DispatchItemSchema =
  SchemaFactory.createForClass(DispatchItemEmbeddable);
