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
import { WarehouseService } from './warehouse.service';
import { Sequence, SequenceSchema } from '../purchase-requests/schemas/sequence.schema';
import { Structure, StructureSchema } from '../structures/schemas/structure.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: WarehouseLocation.name, schema: WarehouseLocationSchema },
      { name: WarehouseInventory.name, schema: WarehouseInventorySchema },
      { name: WarehouseExpense.name, schema: WarehouseExpenseSchema },
      { name: Sequence.name, schema: SequenceSchema },
      { name: Structure.name, schema: StructureSchema },
    ]),
    UsersModule,
  ],
  controllers: [WarehouseController],
  providers: [WarehouseService],
  exports: [WarehouseService],
})
export class WarehouseModule {}

