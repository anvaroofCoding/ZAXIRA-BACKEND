import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ _id: false })
export class OriginalRequestedItemEmbeddable {
  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, trim: true })
  characteristics!: string;

  @Prop({ required: true, min: 1 })
  quantity!: number;

  @Prop({ trim: true, default: '' })
  unit!: string;
}

export const OriginalRequestedItemSchema = SchemaFactory.createForClass(
  OriginalRequestedItemEmbeddable,
);

@Schema({ _id: false })
export class ItemSubstitutionEmbeddable {
  @Prop({ required: true, min: 0 })
  itemIndex!: number;

  @Prop({ required: true, trim: true })
  originalName!: string;

  @Prop({ required: true, trim: true })
  originalCharacteristics!: string;

  @Prop({ required: true, min: 1 })
  originalQuantity!: number;

  @Prop({ trim: true, default: '' })
  originalUnit!: string;

  @Prop({ required: true, trim: true })
  deliveredName!: string;

  @Prop({ required: true, trim: true })
  deliveredCharacteristics!: string;

  @Prop({ required: true, min: 1 })
  deliveredQuantity!: number;

  @Prop({ trim: true, default: '' })
  deliveredUnit!: string;

  @Prop({ required: true, min: 1 })
  amount!: number;
}

export const ItemSubstitutionSchema = SchemaFactory.createForClass(
  ItemSubstitutionEmbeddable,
);
