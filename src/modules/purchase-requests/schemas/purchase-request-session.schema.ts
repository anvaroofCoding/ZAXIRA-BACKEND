import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { PurchasePeriodType } from '../enums/purchase-period-type.enum';
import {
  PurchaseRequestItemEmbeddable,
  PurchaseRequestItemSchema,
} from './purchase-request-item.schema';

export type PurchaseRequestSessionDocument =
  HydratedDocument<PurchaseRequestSession>;

@Schema({
  timestamps: true,
  collection: 'purchase_request_sessions',
})
export class PurchaseRequestSession {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  @Prop({ trim: true, default: '' })
  title!: string;

  @Prop({ type: [Types.ObjectId], default: [] })
  commissionMemberIds!: Types.ObjectId[];

  @Prop({ type: Types.ObjectId })
  bossId?: Types.ObjectId;

  @Prop({ type: [PurchaseRequestItemSchema], default: [] })
  items!: PurchaseRequestItemEmbeddable[];

  /** Sotib olish sababi */
  @Prop({ trim: true, default: '' })
  comment!: string;

  /** Komissiya a'zolari kelishuv varaqasi matni */
  @Prop({ trim: true, default: '' })
  commissionAgreementText!: string;

  @Prop({ type: String, enum: PurchasePeriodType })
  purchasePeriodType?: PurchasePeriodType;

  @Prop({ min: 2000, max: 2100 })
  purchasePeriodYear?: number;

  @Prop({ min: 1, max: 4 })
  purchasePeriodQuarter?: number;

  @Prop({ min: 1, max: 12 })
  purchasePeriodMonth?: number;

  /** ONLYOFFICE va hujjat yuklab olish uchun xavfsiz token */
  @Prop({ trim: true })
  documentToken?: string;

  /** Ariza beruvchi QR tekshiruv tokeni */
  @Prop({ trim: true, index: true })
  applicantVerificationToken?: string;

  @Prop()
  documentsPreparedAt?: Date;

  @Prop({ type: Object, default: {} })
  documentVersions?: Partial<Record<'bildirgi' | 'kelishuv', number>>;

  updatedAt?: Date;
  createdAt?: Date;
}

export const PurchaseRequestSessionSchema = SchemaFactory.createForClass(
  PurchaseRequestSession,
);

PurchaseRequestSessionSchema.index({ userId: 1, updatedAt: -1 });
