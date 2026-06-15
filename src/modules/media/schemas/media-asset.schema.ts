import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type MediaAssetDocument = HydratedDocument<MediaAsset>;

/**
 * Rasm va matn mosligi uchun tayyorlangan schema.
 * Keyingi bosqichda OCR / matching servisi shu model ustida ishlaydi.
 */
@Schema({
  timestamps: true,
  collection: 'media_assets',
})
export class MediaAsset {
  @Prop({ required: true, trim: true })
  imagePath!: string;

  @Prop({ required: true, trim: true })
  textContent!: string;

  @Prop({ required: true, trim: true, index: true })
  normalizedText!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  createdBy?: Types.ObjectId;

  @Prop({ default: true, index: true })
  isActive!: boolean;
}

export const MediaAssetSchema = SchemaFactory.createForClass(MediaAsset);

MediaAssetSchema.index({ normalizedText: 1, isActive: 1 });
MediaAssetSchema.index({ createdAt: -1 });
