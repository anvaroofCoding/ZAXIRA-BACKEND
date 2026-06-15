import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MediaAsset, MediaAssetDocument } from './schemas/media-asset.schema';
import { normalizeText } from './utils/normalize-text.util';

@Injectable()
export class MediaService {
  constructor(
    @InjectModel(MediaAsset.name)
    private readonly mediaModel: Model<MediaAssetDocument>,
  ) {}

  countActive(): Promise<number> {
    return this.mediaModel.countDocuments({ isActive: true }).exec();
  }

  findByNormalizedText(text: string): Promise<MediaAssetDocument | null> {
    return this.mediaModel
      .findOne({ normalizedText: normalizeText(text), isActive: true })
      .exec();
  }
}
