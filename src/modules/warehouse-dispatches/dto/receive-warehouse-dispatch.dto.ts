import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class ReceiveDispatchItemDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  itemIndex!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  quantityReceived!: number;
}

export class RejectDispatchItemDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  itemIndex!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  quantityRejected!: number;

  @IsString()
  @MaxLength(2000)
  reason!: string;
}

export class ReceiveWarehouseDispatchDto {
  @IsOptional()
  @IsMongoId()
  locationId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiveDispatchItemDto)
  receivedItems!: ReceiveDispatchItemDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RejectDispatchItemDto)
  rejectedItems?: RejectDispatchItemDto[];
}
