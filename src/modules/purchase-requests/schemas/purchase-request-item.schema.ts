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

  /** Xarid qilingandan keyin to‘langan summa (so‘m), INDSsiz */
  @Prop({ min: 1 })
  purchaseAmount?: number;

  /** INDS foizi: 0, 6 yoki 12 */
  @Prop({ min: 0, max: 12, default: 0 })
  purchaseVatRate?: number;

  /** 1 dona uchun INDS summasi (so‘m) */
  @Prop({ min: 0, default: 0 })
  purchaseVatAmount?: number;

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
