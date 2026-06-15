import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApprovalDecision } from '../enums/approval-decision.enum';

export class SubmitApprovalDecisionDto {
  @IsEnum(ApprovalDecision)
  decision!: ApprovalDecision;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  comment!: string;
}
