import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module';
import {
  WarehouseInventory,
  WarehouseInventorySchema,
} from './schemas/warehouse-inventory.schema';
import {
  WarehouseLocation,
  WarehouseLocationSchema,
} from './schemas/warehouse-location.schema';
import {
  WarehouseExpense,
  WarehouseExpenseSchema,
} from './schemas/warehouse-expense.schema';
import {
  WarehouseFixedAsset,
  WarehouseFixedAssetSchema,
} from './schemas/warehouse-fixed-asset.schema';
import {
  WarehouseImport,
  WarehouseImportSchema,
} from './schemas/warehouse-import.schema';
import {
  WarehouseImportSession,
  WarehouseImportSessionSchema,
} from './schemas/warehouse-import-session.schema';
import { WarehouseController } from './warehouse.controller';
import { WarehouseImportService } from './warehouse-import.service';
import { WarehousePricingService } from './warehouse-pricing.service';
import { WarehouseService } from './warehouse.service';
import {
  WarehouseDispatch,
  WarehouseDispatchSchema,
} from '../warehouse-dispatches/schemas/warehouse-dispatch.schema';
import {
  Sequence,
  SequenceSchema,
} from '../purchase-requests/schemas/sequence.schema';
import {
  Structure,
  StructureSchema,
} from '../structures/schemas/structure.schema';
import {
  Stocktake,
  StocktakeSchema,
} from '../stocktakes/schemas/stocktake.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: WarehouseLocation.name, schema: WarehouseLocationSchema },
      { name: WarehouseInventory.name, schema: WarehouseInventorySchema },
      { name: WarehouseExpense.name, schema: WarehouseExpenseSchema },
      { name: WarehouseFixedAsset.name, schema: WarehouseFixedAssetSchema },
      { name: WarehouseImport.name, schema: WarehouseImportSchema },
      {
        name: WarehouseImportSession.name,
        schema: WarehouseImportSessionSchema,
      },
      { name: WarehouseDispatch.name, schema: WarehouseDispatchSchema },
      { name: Sequence.name, schema: SequenceSchema },
      { name: Structure.name, schema: StructureSchema },
      { name: Stocktake.name, schema: StocktakeSchema },
    ]),
    UsersModule,
  ],
  controllers: [WarehouseController],
  providers: [WarehouseService, WarehouseImportService, WarehousePricingService],
  exports: [WarehouseService, WarehouseImportService, WarehousePricingService],
})
export class WarehouseModule {}
