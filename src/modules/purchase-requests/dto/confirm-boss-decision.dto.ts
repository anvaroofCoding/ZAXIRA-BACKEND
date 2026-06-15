import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApprovalDecision } from '../enums/approval-decision.enum';

export class ConfirmBossDecisionDto {
  @IsEnum(ApprovalDecision)
  decision!: ApprovalDecision;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  comment!: string;
}
