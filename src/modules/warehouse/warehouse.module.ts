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
import { WarehouseExpense, WarehouseExpenseSchema } from './schemas/warehouse-expense.schema';
import { WarehouseController } from './warehouse.controller';
import { WarehousePricingService } from './warehouse-pricing.service';
import { WarehouseService } from './warehouse.service';
import {
  WarehouseDispatch,
  WarehouseDispatchSchema,
} from '../warehouse-dispatches/schemas/warehouse-dispatch.schema';
import { Sequence, SequenceSchema } from '../purchase-requests/schemas/sequence.schema';
import { Structure, StructureSchema } from '../structures/schemas/structure.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: WarehouseLocation.name, schema: WarehouseLocationSchema },
      { name: WarehouseInventory.name, schema: WarehouseInventorySchema },
      { name: WarehouseExpense.name, schema: WarehouseExpenseSchema },
      { name: WarehouseDispatch.name, schema: WarehouseDispatchSchema },
      { name: Sequence.name, schema: SequenceSchema },
      { name: Structure.name, schema: StructureSchema },
    ]),
    UsersModule,
  ],
  controllers: [WarehouseController],
  providers: [WarehouseService, WarehousePricingService],
  exports: [WarehouseService, WarehousePricingService],
})
export class WarehouseModule {}

