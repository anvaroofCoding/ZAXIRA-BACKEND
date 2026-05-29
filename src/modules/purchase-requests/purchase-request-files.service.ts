import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import * as path from 'path';
import { PurchaseFileEmbeddable } from './schemas/purchase-details.schema';

@Injectable()
export class PurchaseRequestFilesService {
  constructor(private readonly configService: ConfigService) {}

  private getBaseDir() {
    return this.configService.get<string>('upload.dir', './uploads');
  }

  private getRequestDir(requestId: string) {
    return path.join(this.getBaseDir(), 'purchase-requests', requestId);
  }

  resolveStoredPath(requestId: string, storedName: string) {
    const safeName = path.basename(storedName);
    return path.join(this.getRequestDir(requestId), safeName);
  }

  async saveUploadedFiles(
    requestId: string,
    files: Express.Multer.File[],
    labels: string[],
  ): Promise<PurchaseFileEmbeddable[]> {
    if (!files.length) {
      return [];
    }

    const dir = this.getRequestDir(requestId);
    await mkdir(dir, { recursive: true });

    const saved: PurchaseFileEmbeddable[] = [];

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const label = labels[index]?.trim() || file.originalname;
      const extension = path.extname(file.originalname);
      const storedName = `${randomUUID()}${extension}`;

      await writeFile(path.join(dir, storedName), file.buffer);

      saved.push({
        label,
        storedName,
        originalName: file.originalname,
        mimeType: file.mimetype || 'application/octet-stream',
        size: file.size,
      });
    }

    return saved;
  }
}
