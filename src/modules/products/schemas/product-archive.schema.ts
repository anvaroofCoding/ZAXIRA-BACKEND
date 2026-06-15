import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ProductArchiveDocument = HydratedDocument<ProductArchive>;

@Schema({
  timestamps: true,
  collection: 'product_archives',
})
export class ProductArchive {
  @Prop({ required: true, trim: true, unique: true, index: true })
  itemKey!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  archivedById!: Types.ObjectId;

  archivedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export const ProductArchiveSchema =
  SchemaFactory.createForClass(ProductArchive);
