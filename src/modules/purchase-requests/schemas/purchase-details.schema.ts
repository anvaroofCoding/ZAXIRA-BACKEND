import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import {
  ItemSubstitutionEmbeddable,
  ItemSubstitutionSchema,
} from './item-substitution.schema';

@Schema({ _id: false })
export class PurchaseLinkEmbeddable {
  @Prop({ trim: true, default: '' })
  label!: string;

  @Prop({ required: true, trim: true })
  url!: string;
}

export const PurchaseLinkSchema = SchemaFactory.createForClass(
  PurchaseLinkEmbeddable,
);

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

export const PurchaseFileSchema = SchemaFactory.createForClass(
  PurchaseFileEmbeddable,
);

@Schema({ _id: false })
export class PurchaseIshonchnomaEmbeddable {
  @Prop({ type: [PurchaseFileSchema], default: [] })
  files!: PurchaseFileEmbeddable[];

  @Prop({ type: Types.ObjectId, required: true })
  uploadedById!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  uploadedByDisplayName!: string;

  @Prop({ required: true, trim: true })
  uploadedByLogin!: string;

  @Prop({ required: true })
  uploadedAt!: Date;
}

export const PurchaseIshonchnomaSchema = SchemaFactory.createForClass(
  PurchaseIshonchnomaEmbeddable,
);

@Schema({ _id: false })
export class PurchaseItemAmountEmbeddable {
  @Prop({ required: true, min: 0 })
  itemIndex!: number;

  @Prop({ required: true, min: 1 })
  amount!: number;

  @Prop({ min: 0, max: 12, default: 0 })
  vatRate!: number;

  @Prop({ min: 0, default: 0 })
  vatAmount!: number;
}

export const PurchaseItemAmountSchema = SchemaFactory.createForClass(
  PurchaseItemAmountEmbeddable,
);

@Schema({ _id: false })
export class PurchaseDetailsEmbeddable {
  @Prop({ trim: true, default: '' })
  vendorName!: string;

  @Prop({ type: [PurchaseLinkSchema], default: [] })
  links!: PurchaseLinkEmbeddable[];

  @Prop({ type: [PurchaseFileSchema], default: [] })
  files!: PurchaseFileEmbeddable[];

  @Prop({ trim: true, default: '' })
  comment!: string;

  @Prop({ trim: true, default: '' })
  contractNumber!: string;

  @Prop({ trim: true, default: '' })
  organizationName!: string;

  @Prop({ trim: true, default: '' })
  innOrPinfl!: string;

  @Prop({ trim: true, default: '' })
  innOrPinflType!: string;

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

  @Prop({ type: PurchaseIshonchnomaSchema })
  ishonchnoma?: PurchaseIshonchnomaEmbeddable;
}

export const PurchaseDetailsSchema = SchemaFactory.createForClass(
  PurchaseDetailsEmbeddable,
);

@Schema({ _id: false })
export class PurchaseBatchEmbeddable {
  @Prop({ required: true, trim: true })
  batchId!: string;

  @Prop({ trim: true, default: '' })
  comment!: string;

  @Prop({ trim: true, default: '' })
  contractNumber!: string;

  @Prop({ trim: true, default: '' })
  organizationName!: string;

  @Prop({ trim: true, default: '' })
  innOrPinfl!: string;

  @Prop({ trim: true, default: '' })
  innOrPinflType!: string;

  @Prop({ type: [PurchaseLinkSchema], default: [] })
  links!: PurchaseLinkEmbeddable[];

  @Prop({ type: [PurchaseFileSchema], default: [] })
  files!: PurchaseFileEmbeddable[];

  @Prop({ type: [PurchaseItemAmountSchema], required: true })
  itemAmounts!: PurchaseItemAmountEmbeddable[];

  @Prop({ type: [ItemSubstitutionSchema], default: [] })
  itemSubstitutions!: ItemSubstitutionEmbeddable[];

  @Prop({ type: Types.ObjectId, required: true })
  purchasedById!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  purchasedByDisplayName!: string;

  @Prop({ required: true, trim: true })
  purchasedByLogin!: string;

  @Prop({ required: true })
  purchasedAt!: Date;

  @Prop({ type: PurchaseIshonchnomaSchema })
  ishonchnoma?: PurchaseIshonchnomaEmbeddable;
}

export const PurchaseBatchSchema = SchemaFactory.createForClass(
  PurchaseBatchEmbeddable,
);

@Schema({ _id: false })
export class PurchaseUnavailableBatchEmbeddable {
  @Prop({ required: true, trim: true })
  batchId!: string;

  @Prop({ required: true, trim: true })
  comment!: string;

  @Prop({ type: [Number], required: true })
  itemIndexes!: number[];

  @Prop({ type: Types.ObjectId, required: true })
  markedById!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  markedByDisplayName!: string;

  @Prop({ required: true, trim: true })
  markedByLogin!: string;

  @Prop({ required: true })
  markedAt!: Date;
}

export const PurchaseUnavailableBatchSchema = SchemaFactory.createForClass(
  PurchaseUnavailableBatchEmbeddable,
);
