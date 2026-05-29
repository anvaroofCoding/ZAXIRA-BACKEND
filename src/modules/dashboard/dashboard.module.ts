import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module';
import { WarehouseDispatch, WarehouseDispatchSchema } from '../warehouse-dispatches/schemas/warehouse-dispatch.schema';
import { WarehouseExpense, WarehouseExpenseSchema } from '../warehouse/schemas/warehouse-expense.schema';
import { WarehouseInventory, WarehouseInventorySchema } from '../warehouse/schemas/warehouse-inventory.schema';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [
    UsersModule,
    MongooseModule.forFeature([
      { name: WarehouseInventory.name, schema: WarehouseInventorySchema },
      { name: WarehouseDispatch.name, schema: WarehouseDispatchSchema },
      { name: WarehouseExpense.name, schema: WarehouseExpenseSchema },
    ]),
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}

