import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PurchaseRequest,
  PurchaseRequestSchema,
} from '../purchase-requests/schemas/purchase-request.schema';
import {
  PurchaseRequestSession,
  PurchaseRequestSessionSchema,
} from '../purchase-requests/schemas/purchase-request-session.schema';
import { UsersModule } from '../users/users.module';
import {
  WarehouseImport,
  WarehouseImportSchema,
} from '../warehouse/schemas/warehouse-import.schema';
import {
  WarehouseImportSession,
  WarehouseImportSessionSchema,
} from '../warehouse/schemas/warehouse-import-session.schema';
import { MeasurementUnitsController } from './measurement-units.controller';
import { MeasurementUnitsService } from './measurement-units.service';
import {
  CustomMeasurementUnit,
  CustomMeasurementUnitSchema,
} from './schemas/custom-measurement-unit.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CustomMeasurementUnit.name, schema: CustomMeasurementUnitSchema },
      { name: PurchaseRequest.name, schema: PurchaseRequestSchema },
      {
        name: PurchaseRequestSession.name,
        schema: PurchaseRequestSessionSchema,
      },
      { name: WarehouseImport.name, schema: WarehouseImportSchema },
      {
        name: WarehouseImportSession.name,
        schema: WarehouseImportSessionSchema,
      },
    ]),
    UsersModule,
  ],
  controllers: [MeasurementUnitsController],
  providers: [MeasurementUnitsService],
  exports: [MeasurementUnitsService],
})
export class MeasurementUnitsModule {}
