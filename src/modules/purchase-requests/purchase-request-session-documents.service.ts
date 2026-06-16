import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { Types } from 'mongoose';
import { UsersService } from '../users/users.service';
import { PurchaseRequestCommissionDocumentService } from './purchase-request-commission-document.service';
import { PurchaseRequestDocumentService } from './purchase-request-document.service';
import { PurchaseRequestDocument } from './schemas/purchase-request.schema';
import { PurchaseRequestSession } from './schemas/purchase-request-session.schema';
import { PurchaseRequestDocumentSource } from './types/purchase-request-document-source.type';
import { PurchaseFileEmbeddable } from './schemas/purchase-details.schema';

export type SessionDocumentType = 'bildirgi' | 'kelishuv';

const DOCUMENT_FILES: Record<SessionDocumentType, string> = {
  bildirgi: 'bildirgi.docx',
  kelishuv: 'kelishuv.docx',
};

@Injectable()
export class PurchaseRequestSessionDocumentsService {
  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    private readonly documentService: PurchaseRequestDocumentService,
    private readonly commissionDocumentService: PurchaseRequestCommissionDocumentService,
  ) {}

  private getSessionDir(sessionId: string) {
    const baseDir = this.configService.get<string>('upload.dir', './uploads');
    return path.join(baseDir, 'purchase-request-sessions', sessionId);
  }

  private getRequestDocumentsDir(requestId: string) {
    const baseDir = this.configService.get<string>('upload.dir', './uploads');
    return path.join(baseDir, 'purchase-requests', requestId, 'submitted-documents');
  }

  resolveDocumentPath(sessionId: string, docType: SessionDocumentType) {
    return path.join(this.getSessionDir(sessionId), DOCUMENT_FILES[docType]);
  }

  createDocumentToken() {
    return randomBytes(24).toString('hex');
  }

  createApplicantVerificationToken() {
    return randomBytes(18).toString('hex');
  }

  buildApplicantQrUrl(token: string) {
    const apiPublicUrl = this.configService
      .get<string>('apiPublicUrl', 'http://localhost:8000/api')
      .replace(/\/$/, '');
    return `${apiPublicUrl}/public/purchase-requests/verify/${token}`;
  }

  buildDocumentDownloadUrl(
    sessionId: string,
    docType: SessionDocumentType,
    documentToken: string,
  ) {
    const apiPublicUrl = this.configService
      .get<string>('apiPublicUrl', 'http://localhost:8000/api')
      .replace(/\/$/, '');
    return `${apiPublicUrl}/public/purchase-request-sessions/${sessionId}/documents/${docType}?token=${encodeURIComponent(documentToken)}`;
  }

  private async buildUserSnapshots(userIds: string[]) {
    const uniqueIds = [...new Set(userIds)];
    const snapshots = [];

    for (const id of uniqueIds) {
      const user = await this.usersService.findByIdOrFail(id);
      const structure =
        await this.usersService.resolveStructureSnapshotForUser(id);

      snapshots.push({
        userId: new Types.ObjectId(user.id),
        displayName: user.displayName || user.login,
        login: user.login,
        structureShortName: structure?.shortName,
        structureLeaderName: structure?.leaderName?.trim() || '',
        position: user.position?.trim() ?? '',
      });
    }

    return snapshots;
  }

  async buildDraftSource(
    session: PurchaseRequestSession,
    userId: string,
    sessionId: string,
    requestCode: string,
  ): Promise<PurchaseRequestDocumentSource> {
    const applicantUser = await this.usersService.findByIdOrFail(userId);
    const applicantStructure =
      await this.usersService.resolveStructureSnapshotForUser(userId);

    const commissionMemberIds = (session.commissionMemberIds ?? []).map((id) =>
      String(id),
    );
    const commissionMembers = await this.buildUserSnapshots(commissionMemberIds);
    const [boss] = session.bossId
      ? await this.buildUserSnapshots([String(session.bossId)])
      : [
          {
            userId: new Types.ObjectId(),
            displayName: '—',
            login: '—',
            position: '',
          },
        ];

    return {
      id: sessionId,
      requestCode: requestCode.trim(),
      comment: session.comment?.trim() ?? '',
      commissionAgreementText: session.commissionAgreementText?.trim() ?? '',
      items: (session.items ?? []).map((item) => ({
        name: item.name?.trim() ?? '',
        characteristics: item.characteristics?.trim() ?? '',
        quantity: item.quantity ?? 1,
        unit: item.unit?.trim() ?? '',
        manufacturingCountry: item.manufacturingCountry?.trim() ?? '',
      })),
      commissionMembers,
      boss,
      applicant: {
        userId: new Types.ObjectId(applicantUser.id),
        displayName: applicantUser.displayName || applicantUser.login,
        login: applicantUser.login,
        position: applicantUser.position?.trim() ?? '',
      },
      applicantStructure: applicantStructure
        ? {
            structureId: new Types.ObjectId(applicantStructure.structureId),
            fullName: applicantStructure.fullName,
            shortName: applicantStructure.shortName,
            leaderName: applicantStructure.leaderName?.trim() || '',
            capturedAt: applicantStructure.capturedAt,
          }
        : undefined,
      memberDecisions: [],
    };
  }

  async writeKelishuvDocument(
    session: PurchaseRequestSession,
    userId: string,
    sessionId: string,
    requestCode: string,
  ) {
    const dir = this.getSessionDir(sessionId);
    await mkdir(dir, { recursive: true });

    const draft = await this.buildDraftSource(
      session,
      userId,
      sessionId,
      requestCode,
    );
    const kelishuvBuffer =
      await this.commissionDocumentService.generateDocx(draft);

    await writeFile(
      this.resolveDocumentPath(sessionId, 'kelishuv'),
      kelishuvBuffer,
    );
  }

  async prepareSessionDocuments(
    session: PurchaseRequestSession,
    userId: string,
    sessionId: string,
    applicantVerificationToken: string,
    requestCode: string,
    options?: { skipBildirgi?: boolean },
  ) {
    const dir = this.getSessionDir(sessionId);
    await mkdir(dir, { recursive: true });

    const draft = await this.buildDraftSource(
      session,
      userId,
      sessionId,
      requestCode,
    );

    await this.writeKelishuvDocument(session, userId, sessionId, requestCode);

    if (!options?.skipBildirgi) {
      const applicantQrUrl = this.buildApplicantQrUrl(applicantVerificationToken);
      const bildirgiBuffer = await this.documentService.generateDocx(draft, {
        applicantQrUrl,
      });

      await writeFile(
        this.resolveDocumentPath(sessionId, 'bildirgi'),
        bildirgiBuffer,
      );
    }

    return {
      bildirgiPath: this.resolveDocumentPath(sessionId, 'bildirgi'),
      kelishuvPath: this.resolveDocumentPath(sessionId, 'kelishuv'),
    };
  }

  async regenerateRequestKelishuvDocument(request: PurchaseRequestDocument) {
    const source = this.buildDocumentSourceFromRequest(request);
    const buffer = await this.commissionDocumentService.generateDocx(source);
    const targetDir = this.getRequestDocumentsDir(request.id);
    await mkdir(targetDir, { recursive: true });
    await writeFile(path.join(targetDir, 'kelishuv.docx'), buffer);

    return this.buildSubmittedDocumentMeta(
      'kelishuv',
      request.requestCode,
      buffer,
    );
  }

  async readDocument(sessionId: string, docType: SessionDocumentType) {
    const filePath = this.resolveDocumentPath(sessionId, docType);

    try {
      return await readFile(filePath);
    } catch {
      throw new NotFoundException('Hujjat topilmadi — avval tayyorlang');
    }
  }

  async saveDocument(
    sessionId: string,
    docType: SessionDocumentType,
    buffer: Buffer,
  ) {
    const dir = this.getSessionDir(sessionId);
    await mkdir(dir, { recursive: true });
    await writeFile(this.resolveDocumentPath(sessionId, docType), buffer);
  }

  async getDocumentUpdatedAt(sessionId: string, docType: SessionDocumentType) {
    try {
      const fileStat = await stat(this.resolveDocumentPath(sessionId, docType));
      return fileStat.mtimeMs;
    } catch {
      return 0;
    }
  }

  async assertDocumentsReady(sessionId: string) {
    const bildirgi = await this.getDocumentUpdatedAt(sessionId, 'bildirgi');
    const kelishuv = await this.getDocumentUpdatedAt(sessionId, 'kelishuv');

    if (!bildirgi || !kelishuv) {
      throw new BadRequestException(
        'Bildirgi va kelishuv hujjatlari tayyor emas — avval yuklab oling va qayta yuklang',
      );
    }
  }

  private buildSubmittedDocumentMeta(
    docType: SessionDocumentType,
    requestCode: string,
    buffer: Buffer,
  ): PurchaseFileEmbeddable {
    const storedName = `${docType}.docx`;

    return {
      label: docType === 'bildirgi' ? 'Bildirgi' : 'Kelishuv varaqasi',
      storedName,
      originalName: `${docType}-${requestCode}.docx`,
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: buffer.length,
    };
  }

  async saveSubmittedDocumentsToRequest(
    requestId: string,
    requestCode: string,
    documents: Record<SessionDocumentType, Buffer>,
  ): Promise<{
    bildirgi: PurchaseFileEmbeddable;
    kelishuv: PurchaseFileEmbeddable;
  }> {
    const targetDir = this.getRequestDocumentsDir(requestId);
    await mkdir(targetDir, { recursive: true });

    const result: {
      bildirgi: PurchaseFileEmbeddable;
      kelishuv: PurchaseFileEmbeddable;
    } = {} as never;

    for (const docType of ['bildirgi', 'kelishuv'] as const) {
      const buffer = documents[docType];
      if (!buffer?.length) {
        throw new BadRequestException(
          `${docType === 'bildirgi' ? 'Bildirgi' : 'Kelishuv'} Word fayli yuborilmadi`,
        );
      }

      const storedName = `${docType}.docx`;
      await writeFile(path.join(targetDir, storedName), buffer);
      result[docType] = this.buildSubmittedDocumentMeta(
        docType,
        requestCode,
        buffer,
      );
    }

    return result;
  }

  async attachDocumentsToRequest(
    sessionId: string,
    requestId: string,
    requestCode: string,
  ): Promise<{
    bildirgi: PurchaseFileEmbeddable;
    kelishuv: PurchaseFileEmbeddable;
  }> {
    await this.assertDocumentsReady(sessionId);

    const documents: Record<SessionDocumentType, Buffer> = {
      bildirgi: await readFile(this.resolveDocumentPath(sessionId, 'bildirgi')),
      kelishuv: await readFile(this.resolveDocumentPath(sessionId, 'kelishuv')),
    };

    return this.saveSubmittedDocumentsToRequest(
      requestId,
      requestCode,
      documents,
    );
  }

  resolveRequestDocumentPath(requestId: string, storedName: string) {
    const safeName = path.basename(storedName);
    return path.join(this.getRequestDocumentsDir(requestId), safeName);
  }

  async requestHasSubmittedDocxFiles(
    request: Pick<
      PurchaseRequestDocument,
      'id' | 'submittedBildirgi' | 'submittedKelishuv'
    >,
  ): Promise<boolean> {
    const hasDocx = async (
      storedName: string | undefined,
      docType: SessionDocumentType,
    ) => {
      const candidates = [storedName, `${docType}.docx`].filter(
        (value): value is string => Boolean(value),
      );

      for (const candidate of candidates) {
        if (!candidate.toLowerCase().endsWith('.docx')) {
          continue;
        }

        try {
          const filePath = this.resolveRequestDocumentPath(request.id, candidate);
          const fileStat = await stat(filePath);
          if (fileStat.isFile() && fileStat.size > 0) {
            return true;
          }
        } catch {
          // keyingi nomni sinab ko‘ramiz
        }
      }

      return false;
    };

    const [bildirgiReady, kelishuvReady] = await Promise.all([
      hasDocx(request.submittedBildirgi?.storedName, 'bildirgi'),
      hasDocx(request.submittedKelishuv?.storedName, 'kelishuv'),
    ]);

    return bildirgiReady && kelishuvReady;
  }

  async copyRequestDocumentsToSession(
    requestId: string,
    sessionId: string,
    fileMeta?: {
      bildirgi?: Pick<PurchaseFileEmbeddable, 'storedName'>;
      kelishuv?: Pick<PurchaseFileEmbeddable, 'storedName'>;
    },
  ) {
    const dir = this.getSessionDir(sessionId);
    await mkdir(dir, { recursive: true });

    for (const docType of ['bildirgi', 'kelishuv'] as const) {
      const storedName = fileMeta?.[docType]?.storedName ?? `${docType}.docx`;

      if (!storedName.toLowerCase().endsWith('.docx')) {
        throw new NotFoundException(
          `${docType === 'bildirgi' ? 'Bildirgi' : 'Kelishuv'} Word fayli topilmadi`,
        );
      }

      const sourcePath = this.resolveRequestDocumentPath(requestId, storedName);
      const targetPath = this.resolveDocumentPath(sessionId, docType);

      try {
        const buffer = await readFile(sourcePath);
        await writeFile(targetPath, buffer);
      } catch {
        throw new NotFoundException(
          `${docType === 'bildirgi' ? 'Bildirgi' : 'Kelishuv'} hujjati topilmadi`,
        );
      }
    }
  }

  private buildDocumentSourceFromRequest(
    request: PurchaseRequestDocument,
  ): PurchaseRequestDocumentSource {
    return {
      id: request.id,
      requestCode: request.requestCode,
      comment: request.comment?.trim() ?? '',
      commissionAgreementText: request.commissionAgreementText?.trim() ?? '',
      items: request.items ?? [],
      commissionMembers: request.commissionMembers ?? [],
      boss: request.boss,
      applicant: request.applicant,
      applicantStructure: request.applicantStructure,
      bossDecision: request.bossDecision,
      bossConfirmedAt: request.bossConfirmedAt,
      memberDecisions: request.memberDecisions ?? [],
    };
  }

  /** Boshliq tasdiqlagach yuborilgan hujjatlarni PDF ga aylantiradi */
  async convertSubmittedDocumentsToPdf(request: PurchaseRequestDocument) {
    const source = this.buildDocumentSourceFromRequest(request);
    const applicantQrUrl = request.applicantVerificationToken
      ? this.buildApplicantQrUrl(request.applicantVerificationToken)
      : undefined;

    const [bildirgiBuffer, kelishuvBuffer] = await Promise.all([
      this.documentService.generatePdf(source, { applicantQrUrl }),
      this.commissionDocumentService.generatePdf(source),
    ]);

    const targetDir = this.getRequestDocumentsDir(request.id);
    await mkdir(targetDir, { recursive: true });

    const bildirgiStored = 'bildirgi.pdf';
    const kelishuvStored = 'kelishuv.pdf';

    await Promise.all([
      writeFile(path.join(targetDir, bildirgiStored), bildirgiBuffer),
      writeFile(path.join(targetDir, kelishuvStored), kelishuvBuffer),
    ]);

    return {
      bildirgi: {
        label: 'Bildirgi',
        storedName: bildirgiStored,
        originalName: `bildirgi-${request.requestCode}.pdf`,
        mimeType: 'application/pdf',
        size: bildirgiBuffer.length,
      },
      kelishuv: {
        label: 'Kelishuv varaqasi',
        storedName: kelishuvStored,
        originalName: `kelishuv-${request.requestCode}.pdf`,
        mimeType: 'application/pdf',
        size: kelishuvBuffer.length,
      },
    };
  }
}
