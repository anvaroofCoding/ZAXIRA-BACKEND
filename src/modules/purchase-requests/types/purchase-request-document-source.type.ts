import { ApprovalDecision } from '../enums/approval-decision.enum';
import { PurchaseRequestItemEmbeddable } from '../schemas/purchase-request-item.schema';
import { StructureSnapshotEmbeddable } from '../../structures/schemas/structure-snapshot.schema';
import { UserSnapshotEmbeddable } from '../schemas/user-snapshot.schema';

/** Bildirgi / kelishuv hujjatlari uchun minimal ma'lumot manbai */
export interface PurchaseRequestDocumentSource {
  id: string;
  requestCode: string;
  comment: string;
  commissionAgreementText?: string;
  items: PurchaseRequestItemEmbeddable[];
  commissionMembers?: UserSnapshotEmbeddable[];
  boss: UserSnapshotEmbeddable;
  applicant: UserSnapshotEmbeddable;
  applicantStructure?: StructureSnapshotEmbeddable;
  bossDecision?: ApprovalDecision;
  bossConfirmedAt?: Date;
  memberDecisions?: Array<{
    userId: UserSnapshotEmbeddable['userId'];
    decision?: ApprovalDecision;
    decidedAt?: Date;
    position?: string;
  }>;
}

export interface GenerateDocxOptions {
  /** Ariza beruvchi imzosi o'rniga QR (bildirgi va kelishuv) */
  applicantQrUrl?: string;
}

export interface GenerateKelishuvDocxOptions {
  /** Ariza beruvchi tasdiqlash QR (yuborish bosqichida) */
  applicantQrUrl?: string;
}

export interface GeneratePdfOptions {
  /** Ariza beruvchi tasdiqlash QR (bildirgi) */
  applicantQrUrl?: string;
}
