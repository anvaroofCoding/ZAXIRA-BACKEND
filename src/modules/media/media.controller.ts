import { Controller, Get } from '@nestjs/common';
import { MediaService } from './media.service';

@Controller('media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Get('status')
  async status() {
    const total = await this.mediaService.countActive();

    return {
      module: 'media',
      ready: true,
      activeAssets: total,
      note: 'Rasm-matn mosligi moduli keyingi bosqichda to‘ldiriladi',
    };
  }
}
