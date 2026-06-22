import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

class DeviceTelemetryPayloadDto {
  @IsOptional()
  @IsNumber()
  ramGb?: number | null;

  @IsOptional()
  @IsNumber()
  cpuCores?: number | null;

  @IsOptional()
  @IsString()
  processor?: string | null;

  @IsOptional()
  @IsString()
  processorModel?: string | null;

  @IsOptional()
  @IsString()
  processorArchitecture?: string | null;

  @IsOptional()
  @IsString()
  processorPlatform?: string | null;

  @IsOptional()
  @IsString()
  networkType?: string | null;

  @IsOptional()
  @IsNumber()
  networkDownlinkMbps?: number | null;

  @IsOptional()
  @IsNumber()
  networkRttMs?: number | null;

  @IsOptional()
  @IsNumber()
  memoryUsedPercent?: number | null;

  @IsOptional()
  @IsNumber()
  jsHeapUsedMb?: number | null;

  @IsOptional()
  @IsNumber()
  jsHeapLimitMb?: number | null;

  @IsOptional()
  @IsNumber()
  storageUsedMb?: number | null;

  @IsOptional()
  @IsNumber()
  storageQuotaMb?: number | null;

  @IsOptional()
  @IsNumber()
  storageUsedPercent?: number | null;

  @IsOptional()
  @IsNumber()
  screenWidth?: number | null;

  @IsOptional()
  @IsNumber()
  screenHeight?: number | null;

  @IsOptional()
  @IsNumber()
  devicePixelRatio?: number | null;

  @IsOptional()
  @IsString()
  language?: string | null;

  @IsOptional()
  @IsString()
  timezone?: string | null;

  @IsOptional()
  @IsString()
  collectedAt?: string | null;
}

export class ReportDeviceTelemetryDto {
  @IsOptional()
  @IsString()
  deviceId?: string;

  @IsOptional()
  @IsString()
  deviceName?: string;

  @IsObject()
  @ValidateNested()
  @Type(() => DeviceTelemetryPayloadDto)
  telemetry!: DeviceTelemetryPayloadDto;
}
