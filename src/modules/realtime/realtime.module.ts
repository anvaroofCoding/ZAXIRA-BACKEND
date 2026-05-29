import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { PurchaseRequestsEventsService } from './purchase-requests-events.service';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  imports: [AuthModule, UsersModule],
  providers: [RealtimeGateway, PurchaseRequestsEventsService],
  exports: [RealtimeGateway, PurchaseRequestsEventsService],
})
export class RealtimeModule {}
