import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateWarehouseLocationDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;
}
