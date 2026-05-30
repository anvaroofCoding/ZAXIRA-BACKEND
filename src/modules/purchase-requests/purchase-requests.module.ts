import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { RealtimeModule } from '../realtime/realtime.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WarehouseDispatchesModule } from '../warehouse-dispatches/warehouse-dispatches.module';
import { UsersModule } from '../users/users.module';
import { PurchaseRequestDocumentService } from './purchase-request-document.service';
import { PurchaseRequestFilesService } from './purchase-request-files.service';
import { PurchaseRequestsController } from './purchase-requests.controller';
import { PurchaseRequestsService } from './purchase-requests.service';
import {
  PurchaseRequest,
  PurchaseRequestSchema,
} from './schemas/purchase-request.schema';
import { Sequence, SequenceSchema } from './schemas/sequence.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PurchaseRequest.name, schema: PurchaseRequestSchema },
      { name: Sequence.name, schema: SequenceSchema },
    ]),
    UsersModule,
    RealtimeModule,
    NotificationsModule,
    forwardRef(() => WarehouseDispatchesModule),
    ConfigModule,
  ],
  controllers: [PurchaseRequestsController],
  providers: [
    PurchaseRequestsService,
    PurchaseRequestDocumentService,
    PurchaseRequestFilesService,
  ],
  exports: [PurchaseRequestsService],
})
export class PurchaseRequestsModule {}
