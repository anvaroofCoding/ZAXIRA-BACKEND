import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  PURCHASE_REJECTION_REASON_KEYS,
  type PurchaseRejectionReasonKey,
} from '../constants/purchase-rejection-reasons';

export class RejectPurchaseDto {
  @IsIn(PURCHASE_REJECTION_REASON_KEYS)
  reasonKey!: PurchaseRejectionReasonKey;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}
