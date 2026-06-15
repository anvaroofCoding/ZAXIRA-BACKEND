import { Controller, Get, Query, StreamableFile } from '@nestjs/common';
import { SkipTransform } from '../../common/decorators/skip-transform.decorator';

@Controller('health')
export class HealthController {
  @Get()
  check() {
    return {
      status: 'ok',
      service: 'zaxira-back',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('speed-test')
  @SkipTransform()
  speedTest(@Query('kb') kb?: string) {
    const parsed = Number.parseInt(String(kb ?? ''), 10);
    const sizeKb = Number.isFinite(parsed)
      ? Math.min(512, Math.max(64, parsed))
      : 256;

    return new StreamableFile(Buffer.alloc(sizeKb * 1024, 0), {
      type: 'application/octet-stream',
      disposition: 'inline',
    });
  }
}
