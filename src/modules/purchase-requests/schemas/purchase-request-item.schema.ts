import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ _id: false })
export class PurchaseRequestItemEmbeddable {
  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, trim: true })
  characteristics!: string;

  @Prop({ required: true, min: 1 })
  quantity!: number;

  /** Xarid qilingandan keyin to‘langan summa (so‘m) */
  @Prop({ min: 1 })
  purchaseAmount?: number;
}

export const PurchaseRequestItemSchema = SchemaFactory.createForClass(
  PurchaseRequestItemEmbeddable,
);
