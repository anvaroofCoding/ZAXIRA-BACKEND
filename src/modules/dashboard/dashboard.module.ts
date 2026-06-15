import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module';
import { WarehouseModule } from '../warehouse/warehouse.module';
import {
  WarehouseDispatch,
  WarehouseDispatchSchema,
} from '../warehouse-dispatches/schemas/warehouse-dispatch.schema';
import {
  PurchaseRequest,
  PurchaseRequestSchema,
} from '../purchase-requests/schemas/purchase-request.schema';
import {
  WarehouseExpense,
  WarehouseExpenseSchema,
} from '../warehouse/schemas/warehouse-expense.schema';
import {
  WarehouseInventory,
  WarehouseInventorySchema,
} from '../warehouse/schemas/warehouse-inventory.schema';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [
    UsersModule,
    WarehouseModule,
    MongooseModule.forFeature([
      { name: WarehouseInventory.name, schema: WarehouseInventorySchema },
      { name: WarehouseDispatch.name, schema: WarehouseDispatchSchema },
      { name: WarehouseExpense.name, schema: WarehouseExpenseSchema },
      { name: PurchaseRequest.name, schema: PurchaseRequestSchema },
    ]),
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
