import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

@Schema({ _id: false })
export class PurchaseLinkEmbeddable {
  @Prop({ trim: true, default: '' })
  label!: string;

  @Prop({ required: true, trim: true })
  url!: string;
}

export const PurchaseLinkSchema =
  SchemaFactory.createForClass(PurchaseLinkEmbeddable);

@Schema({ _id: false })
export class PurchaseFileEmbeddable {
  @Prop({ required: true, trim: true })
  label!: string;

  @Prop({ required: true, trim: true })
  storedName!: string;

  @Prop({ required: true, trim: true })
  originalName!: string;

  @Prop({ required: true, trim: true })
  mimeType!: string;

  @Prop({ required: true, min: 0 })
  size!: number;
}

export const PurchaseFileSchema =
  SchemaFactory.createForClass(PurchaseFileEmbeddable);

@Schema({ _id: false })
export class PurchaseItemAmountEmbeddable {
  @Prop({ required: true, min: 0 })
  itemIndex!: number;

  @Prop({ required: true, min: 1 })
  amount!: number;
}

export const PurchaseItemAmountSchema = SchemaFactory.createForClass(
  PurchaseItemAmountEmbeddable,
);

@Schema({ _id: false })
export class PurchaseDetailsEmbeddable {
  @Prop({ required: true, trim: true })
  vendorName!: string;

  @Prop({ type: [PurchaseLinkSchema], default: [] })
  links!: PurchaseLinkEmbeddable[];

  @Prop({ type: [PurchaseFileSchema], default: [] })
  files!: PurchaseFileEmbeddable[];

  @Prop({ trim: true, default: '' })
  comment!: string;

  @Prop({ type: [PurchaseItemAmountSchema], required: true })
  itemAmounts!: PurchaseItemAmountEmbeddable[];

  @Prop({ type: Types.ObjectId, required: true })
  purchasedById!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  purchasedByDisplayName!: string;

  @Prop({ required: true, trim: true })
  purchasedByLogin!: string;

  @Prop({ required: true })
  purchasedAt!: Date;
}

export const PurchaseDetailsSchema = SchemaFactory.createForClass(
  PurchaseDetailsEmbeddable,
);
