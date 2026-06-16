import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  StructureSnapshotEmbeddable,
  StructureSnapshotSchema,
} from '../../structures/schemas/structure-snapshot.schema';
import { ApprovalDecision } from '../enums/approval-decision.enum';
import { PurchasePeriodType } from '../enums/purchase-period-type.enum';
import { PurchaseRequestStatus } from '../enums/purchase-request-status.enum';
import {
  HistoryStepEmbeddable,
  HistoryStepSchema,
} from './history-step.schema';
import {
  MemberDecisionEmbeddable,
  MemberDecisionSchema,
} from './member-decision.schema';
import {
  PurchaseRequestItemEmbeddable,
  PurchaseRequestItemSchema,
} from './purchase-request-item.schema';
import {
  PurchaseBatchEmbeddable,
  PurchaseBatchSchema,
  PurchaseDetailsEmbeddable,
  PurchaseDetailsSchema,
  PurchaseFileEmbeddable,
  PurchaseFileSchema,
  PurchaseUnavailableBatchEmbeddable,
  PurchaseUnavailableBatchSchema,
} from './purchase-details.schema';
import {
  UserSnapshotEmbeddable,
  UserSnapshotSchema,
} from './user-snapshot.schema';

export type PurchaseRequestDocument = HydratedDocument<PurchaseRequest>;

@Schema({
  timestamps: true,
  collection: 'purchase_requests',
})
export class PurchaseRequest {
  /**
   * Legacy numeric sequence (DBda eski unique index qolgan bo'lishi mumkin).
   * Ariza kodi (`requestCode`) bilan birga saqlanadi.
   */
  @Prop({ required: true, unique: true, index: true })
  number!: number;

  @Prop({
    required: true,
    unique: true,
    index: true,
    uppercase: true,
    trim: true,
  })
  requestCode!: string;

  @Prop({
    type: String,
    enum: PurchaseRequestStatus,
    default: PurchaseRequestStatus.COMMISSION_REVIEW,
    index: true,
  })
  status!: PurchaseRequestStatus;

  @Prop({ type: [UserSnapshotSchema], required: true })
  commissionMembers!: UserSnapshotEmbeddable[];

  @Prop({ type: UserSnapshotSchema, required: true })
  boss!: UserSnapshotEmbeddable;

  @Prop({ type: [PurchaseRequestItemSchema], required: true })
  items!: PurchaseRequestItemEmbeddable[];

  @Prop({ trim: true, default: '' })
  comment!: string;

  /** Komissiya a'zolari kelishuv varaqasi matni */
  @Prop({ trim: true, default: '' })
  commissionAgreementText!: string;

  /** Tovarlarni sotib olish uchun belgilangan muddat (eski format) */
  @Prop()
  purchaseDeadline?: Date;

  /** Muddat majburiy (true) yoki tavsiya (false) */
  @Prop({ default: false })
  purchaseDeadlineMandatory!: boolean;

  /** Sotib olish davri turi: chorak yoki oy */
  @Prop({ type: String, enum: PurchasePeriodType })
  purchasePeriodType?: PurchasePeriodType;

  @Prop({ min: 2000, max: 2100 })
  purchasePeriodYear?: number;

  @Prop({ min: 1, max: 4 })
  purchasePeriodQuarter?: number;

  @Prop({ min: 1, max: 12 })
  purchasePeriodMonth?: number;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  createdById!: Types.ObjectId;

  @Prop({ type: UserSnapshotSchema, required: true })
  applicant!: UserSnapshotEmbeddable;

  @Prop({ type: StructureSnapshotSchema })
  applicantStructure?: StructureSnapshotEmbeddable;

  @Prop({ type: [MemberDecisionSchema], default: [] })
  memberDecisions!: MemberDecisionEmbeddable[];

  @Prop({ type: [HistoryStepSchema], default: [] })
  history!: HistoryStepEmbeddable[];

  /** Ariza beruvchi atkazdan keyin qayta yuborgan vaqti */
  @Prop()
  resubmittedAfterPartialAt?: Date;

  @Prop()
  bossConfirmedAt?: Date;

  @Prop({ type: String, enum: ApprovalDecision })
  bossDecision?: ApprovalDecision;

  @Prop({ trim: true, default: '' })
  bossConfirmComment!: string;

  @Prop({ type: PurchaseDetailsSchema })
  purchase?: PurchaseDetailsEmbeddable;

  @Prop({ type: [PurchaseBatchSchema], default: [] })
  purchaseBatches!: PurchaseBatchEmbeddable[];

  @Prop({ type: [PurchaseUnavailableBatchSchema], default: [] })
  purchaseUnavailableBatches!: PurchaseUnavailableBatchEmbeddable[];

  /** Ariza beruvchi QR orqali tekshirish tokeni */
  @Prop({ trim: true, index: true })
  applicantVerificationToken?: string;

  @Prop({ type: PurchaseFileSchema })
  submittedBildirgi?: PurchaseFileEmbeddable;

  @Prop({ type: PurchaseFileSchema })
  submittedKelishuv?: PurchaseFileEmbeddable;

  createdAt?: Date;
  updatedAt?: Date;
}

export const PurchaseRequestSchema =
  SchemaFactory.createForClass(PurchaseRequest);

PurchaseRequestSchema.index({ createdById: 1, createdAt: -1 });
PurchaseRequestSchema.index({ 'commissionMembers.userId': 1, createdAt: -1 });
PurchaseRequestSchema.index({ 'boss.userId': 1, createdAt: -1 });
// Unique indexlar allaqachon @Prop darajasida berilgan,
// shuning uchun bu yerda takroran e'lon qilish shart emas.
