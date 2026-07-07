import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import * as path from 'path';
import { TaskFileEmbeddable } from './schemas/task-file.schema';

@Injectable()
export class TaskFilesService {
  constructor(private readonly configService: ConfigService) {}

  private getBaseDir() {
    return this.configService.get<string>('upload.dir', './uploads');
  }

  private getGroupDir(groupId: string) {
    return path.join(this.getBaseDir(), 'tasks', groupId);
  }

  resolveStoredPath(groupId: string, storedName: string) {
    const safeName = path.basename(storedName);
    return path.join(this.getGroupDir(groupId), safeName);
  }

  async saveUploadedFiles(
    groupId: string,
    files: Express.Multer.File[],
  ): Promise<TaskFileEmbeddable[]> {
    if (!files.length) {
      return [];
    }

    return Promise.all(files.map((file) => this.saveUploadedFile(groupId, file)));
  }

  async saveUploadedFile(
    groupId: string,
    file: Express.Multer.File,
  ): Promise<TaskFileEmbeddable> {
    const dir = this.getGroupDir(groupId);
    await mkdir(dir, { recursive: true });

    const extension = path.extname(file.originalname);
    const storedName = `${randomUUID()}${extension}`;

    await writeFile(path.join(dir, storedName), file.buffer);

    return {
      storedName,
      originalName: file.originalname,
      mimeType: file.mimetype || 'application/octet-stream',
      size: file.size,
    };
  }
}
