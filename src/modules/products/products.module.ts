import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module';
import {
  PurchaseRequest,
  PurchaseRequestSchema,
} from '../purchase-requests/schemas/purchase-request.schema';
import {
  WarehouseInventory,
  WarehouseInventorySchema,
} from '../warehouse/schemas/warehouse-inventory.schema';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import {
  ProductArchive,
  ProductArchiveSchema,
} from './schemas/product-archive.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PurchaseRequest.name, schema: PurchaseRequestSchema },
      { name: WarehouseInventory.name, schema: WarehouseInventorySchema },
      { name: ProductArchive.name, schema: ProductArchiveSchema },
    ]),
    UsersModule,
  ],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
