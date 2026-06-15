import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ApprovalDecision } from '../enums/approval-decision.enum';

@Schema({ _id: false })
export class MemberDecisionEmbeddable {
  @Prop({ type: Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  displayName!: string;

  @Prop({ required: true, trim: true })
  login!: string;

  @Prop({ trim: true })
  structureShortName?: string;

  @Prop({ trim: true })
  position?: string;

  @Prop({ type: String, enum: ApprovalDecision })
  decision?: ApprovalDecision;

  @Prop({ trim: true, default: '' })
  comment!: string;

  @Prop()
  decidedAt?: Date;
}

export const MemberDecisionSchema = SchemaFactory.createForClass(
  MemberDecisionEmbeddable,
);
