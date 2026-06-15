import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { RealtimeModule } from '../realtime/realtime.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WarehouseDispatchesModule } from '../warehouse-dispatches/warehouse-dispatches.module';
import { UsersModule } from '../users/users.module';
import { PurchaseRequestCommissionDocumentService } from './purchase-request-commission-document.service';
import { PurchaseRequestDocumentService } from './purchase-request-document.service';
import { PurchaseRequestFilesService } from './purchase-request-files.service';
import { OnlyOfficeService } from './onlyoffice.service';
import { PurchaseRequestOnlyOfficePublicController } from './purchase-request-onlyoffice-public.controller';
import { PurchaseRequestPublicController } from './purchase-request-public.controller';
import { PurchaseRequestSessionDocumentsService } from './purchase-request-session-documents.service';
import { PurchaseRequestsController } from './purchase-requests.controller';
import { PurchaseRequestsService } from './purchase-requests.service';
import { PurchaseRequestAiService } from './purchase-request-ai.service';
import {
  PurchaseRequest,
  PurchaseRequestSchema,
} from './schemas/purchase-request.schema';
import {
  PurchaseRequestSession,
  PurchaseRequestSessionSchema,
} from './schemas/purchase-request-session.schema';
import { Sequence, SequenceSchema } from './schemas/sequence.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PurchaseRequest.name, schema: PurchaseRequestSchema },
      { name: PurchaseRequestSession.name, schema: PurchaseRequestSessionSchema },
      { name: Sequence.name, schema: SequenceSchema },
    ]),
    UsersModule,
    RealtimeModule,
    NotificationsModule,
    forwardRef(() => WarehouseDispatchesModule),
    ConfigModule,
  ],
  controllers: [
    PurchaseRequestsController,
    PurchaseRequestPublicController,
    PurchaseRequestOnlyOfficePublicController,
  ],
  providers: [
    PurchaseRequestsService,
    PurchaseRequestAiService,
    PurchaseRequestDocumentService,
    PurchaseRequestCommissionDocumentService,
    PurchaseRequestFilesService,
    PurchaseRequestSessionDocumentsService,
    OnlyOfficeService,
  ],
  exports: [PurchaseRequestsService],
})
export class PurchaseRequestsModule {}
