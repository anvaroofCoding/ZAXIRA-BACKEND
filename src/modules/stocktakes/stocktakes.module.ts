import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module';
import {
  Sequence,
  SequenceSchema,
} from '../purchase-requests/schemas/sequence.schema';
import {
  Structure,
  StructureSchema,
} from '../structures/schemas/structure.schema';
import {
  WarehouseInventory,
  WarehouseInventorySchema,
} from '../warehouse/schemas/warehouse-inventory.schema';
import {
  WarehouseLocation,
  WarehouseLocationSchema,
} from '../warehouse/schemas/warehouse-location.schema';
import { Stocktake, StocktakeSchema } from './schemas/stocktake.schema';
import { StocktakesController } from './stocktakes.controller';
import { StocktakesService } from './stocktakes.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Stocktake.name, schema: StocktakeSchema },
      { name: WarehouseInventory.name, schema: WarehouseInventorySchema },
      { name: WarehouseLocation.name, schema: WarehouseLocationSchema },
      { name: Structure.name, schema: StructureSchema },
      { name: Sequence.name, schema: SequenceSchema },
    ]),
    UsersModule,
  ],
  controllers: [StocktakesController],
  providers: [StocktakesService],
  exports: [StocktakesService],
})
export class StocktakesModule {}
