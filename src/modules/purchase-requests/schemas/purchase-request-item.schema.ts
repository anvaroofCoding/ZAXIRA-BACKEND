import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  OriginalRequestedItemEmbeddable,
  OriginalRequestedItemSchema,
} from './item-substitution.schema';

@Schema({ _id: false })
export class PurchaseRequestItemEmbeddable {
  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, trim: true })
  characteristics!: string;

  @Prop({ required: true, min: 1 })
  quantity!: number;

  /** O‘lchov birligi (masalan: dona, kg, litr) */
  @Prop({ trim: true, default: '' })
  unit!: string;

  /** Ishlab chiqarilgan davlat */
  @Prop({ trim: true, default: '' })
  manufacturingCountry!: string;

  /** Xarid qilingandan keyin to‘langan summa (so‘m) */
  @Prop({ min: 1 })
  purchaseAmount?: number;

  /** Tovar xarid qilinganligi */
  @Prop({ default: false })
  isPurchased?: boolean;

  @Prop()
  purchasedAt?: Date;

  @Prop({ trim: true })
  purchaseBatchId?: string;

  /** Tovar xarid qilib bo‘lmaydi deb belgilangan */
  @Prop({ default: false })
  isPurchaseUnavailable?: boolean;

  @Prop({ trim: true })
  purchaseUnavailableReason?: string;

  @Prop()
  purchaseUnavailableAt?: Date;

  @Prop({ trim: true })
  purchaseUnavailableBatchId?: string;

  /** Almashtirishdan oldingi asl so‘ralgan tovar (faqat o‘zgartirilganda) */
  @Prop({ type: OriginalRequestedItemSchema })
  originalRequestedItem?: OriginalRequestedItemEmbeddable;
}

export const PurchaseRequestItemSchema = SchemaFactory.createForClass(
  PurchaseRequestItemEmbeddable,
);
