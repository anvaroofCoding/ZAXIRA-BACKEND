import { Type } from 'class-transformer';
import { IsArray, IsInt, IsMongoId, IsNotEmpty, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';

export class CreateTransferDispatchItemDto {
  @IsMongoId()
  locationId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  barcode!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;
}

export class CreateTransferDispatchDto {
  @IsMongoId()
  structureId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateTransferDispatchItemDto)
  items!: CreateTransferDispatchItemDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  plannedArrivalAt?: string;
}
