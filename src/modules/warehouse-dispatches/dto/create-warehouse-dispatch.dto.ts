import { Type } from 'class-transformer';
import { IsMongoId, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateWarehouseDispatchDto {
  @IsMongoId()
  purchaseRequestId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  purchaseBatchId?: string;

  @IsMongoId()
  structureId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  plannedArrivalAt?: string;
}
