import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { MediaAsset, MediaAssetSchema } from './schemas/media-asset.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MediaAsset.name, schema: MediaAssetSchema },
    ]),
  ],
  controllers: [MediaController],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}
