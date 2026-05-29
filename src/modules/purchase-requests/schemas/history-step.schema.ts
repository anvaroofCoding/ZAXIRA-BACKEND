import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ApprovalDecision } from '../enums/approval-decision.enum';

export enum HistoryStepType {
  SUBMITTED = 'SUBMITTED',
  DECISION = 'DECISION',
  RESUBMITTED = 'RESUBMITTED',
  BOSS_CONFIRMED = 'BOSS_CONFIRMED',
  BOSS_DECISION = 'BOSS_DECISION',
  PURCHASED = 'PURCHASED',
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

  @Prop({ required: true, default: () => new Date() })
  createdAt!: Date;
}

export const HistoryStepSchema =
  SchemaFactory.createForClass(HistoryStepEmbeddable);
