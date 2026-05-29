import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { PurchaseRequestsModule } from '../purchase-requests/purchase-requests.module';
import { Sequence, SequenceSchema } from '../purchase-requests/schemas/sequence.schema';
import { StructuresModule } from '../structures/structures.module';
import { UsersModule } from '../users/users.module';
import { WarehouseModule } from '../warehouse/warehouse.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { WarehouseDispatchDocumentService } from './warehouse-dispatch-document.service';
import { WarehouseDispatchesController } from './warehouse-dispatches.controller';
import { WarehouseDispatchesService } from './warehouse-dispatches.service';
import { WarehouseInventory, WarehouseInventorySchema } from '../warehouse/schemas/warehouse-inventory.schema';
import { WarehouseLocation, WarehouseLocationSchema } from '../warehouse/schemas/warehouse-location.schema';
import {
  WarehouseDispatch,
  WarehouseDispatchSchema,
} from './schemas/warehouse-dispatch.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: WarehouseDispatch.name, schema: WarehouseDispatchSchema },
      { name: Sequence.name, schema: SequenceSchema },
      { name: WarehouseLocation.name, schema: WarehouseLocationSchema },
      { name: WarehouseInventory.name, schema: WarehouseInventorySchema },
    ]),
    forwardRef(() => PurchaseRequestsModule),
    StructuresModule,
    UsersModule,
    RealtimeModule,
    ConfigModule,
    WarehouseModule,
  ],
  controllers: [WarehouseDispatchesController],
  providers: [WarehouseDispatchesService, WarehouseDispatchDocumentService],
  exports: [WarehouseDispatchesService],
})
export class WarehouseDispatchesModule {}
