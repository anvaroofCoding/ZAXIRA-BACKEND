import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ApprovalDecision } from '../enums/approval-decision.enum';
import {
  ItemSubstitutionEmbeddable,
  ItemSubstitutionSchema,
} from './item-substitution.schema';

export enum HistoryStepType {
  SUBMITTED = 'SUBMITTED',
  UPDATED = 'UPDATED',
  DECISION = 'DECISION',
  RESUBMITTED = 'RESUBMITTED',
  BOSS_CONFIRMED = 'BOSS_CONFIRMED',
  BOSS_DECISION = 'BOSS_DECISION',
  PARTIAL_PURCHASE = 'PARTIAL_PURCHASE',
  PURCHASED = 'PURCHASED',
  ITEMS_UNAVAILABLE = 'ITEMS_UNAVAILABLE',
  PURCHASE_REJECTED = 'PURCHASE_REJECTED',
}

@Schema({ _id: false })
export class HistoryStepEmbeddable {
  @Prop({ type: String, enum: HistoryStepType, required: true })
  type!: HistoryStepType;

  @Prop({ type: Types.ObjectId, required: true })
  actorUserId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  actorDisplayName!: string;

  @Prop({ required: true, trim: true })
  actorLogin!: string;

  @Prop({ type: String, enum: ApprovalDecision })
  decision?: ApprovalDecision;

  @Prop({ trim: true, default: '' })
  comment!: string;

  @Prop({ trim: true })
  rejectionReasonKey?: string;

  @Prop()
  purchaseDeadline?: Date;

  @Prop()
  purchaseDeadlineMandatory?: boolean;

  @Prop({ required: true, default: () => new Date() })
  createdAt!: Date;

  @Prop({ type: [Number], default: [] })
  purchasedItemIndexes?: number[];

  @Prop({ type: [Number], default: [] })
  unavailableItemIndexes?: number[];

  @Prop({ type: [ItemSubstitutionSchema], default: [] })
  itemSubstitutions?: ItemSubstitutionEmbeddable[];

  @Prop({ trim: true, default: '' })
  purchaseBatchId?: string;

  @Prop({ trim: true, default: '' })
  contractNumber?: string;

  @Prop({ trim: true, default: '' })
  organizationName?: string;

  @Prop({ trim: true, default: '' })
  innOrPinfl?: string;

  @Prop({ trim: true, default: '' })
  innOrPinflType?: string;
}

export const HistoryStepSchema = SchemaFactory.createForClass(
  HistoryStepEmbeddable,
);
