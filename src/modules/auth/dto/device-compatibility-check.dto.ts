import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { ReportDeviceTelemetryDto } from './report-device-telemetry.dto';

class DeviceCompatibilityCheckItemDto {
  @IsString()
  @IsNotEmpty()
  key!: string;

  @IsString()
  @IsNotEmpty()
  label!: string;

  @IsString()
  @IsNotEmpty()
  requiredLabel!: string;

  @IsString()
  @IsNotEmpty()
  actualLabel!: string;

  @IsIn(['pass', 'fail', 'unknown'])
  status!: 'pass' | 'fail' | 'unknown';

  @IsOptional()
  @IsString()
  note?: string | null;
}

export class DeviceCompatibilityCheckDto extends ReportDeviceTelemetryDto {
  @IsBoolean()
  isCompatible!: boolean;

  @IsIn(['pass', 'fail', 'partial'])
  overallStatus!: 'pass' | 'fail' | 'partial';

  @IsString()
  @IsNotEmpty()
  summary!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeviceCompatibilityCheckItemDto)
  checks!: DeviceCompatibilityCheckItemDto[];
}
