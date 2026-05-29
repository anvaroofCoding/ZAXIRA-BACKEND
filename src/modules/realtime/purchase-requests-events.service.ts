import { Injectable } from '@nestjs/common';
import { PurchaseRequestDocument } from '../purchase-requests/schemas/purchase-request.schema';
import { RealtimeGateway } from './realtime.gateway';

export type PurchaseRequestRealtimeEvent = 'created' | 'updated';

export interface PurchaseRequestChangedPayload {
  requestId: string;
  requestCode: string;
  event: PurchaseRequestRealtimeEvent;
  status: string;
}

@Injectable()
export class PurchaseRequestsEventsService {
  constructor(private readonly realtimeGateway: RealtimeGateway) {}

  notifyChanged(
    request: PurchaseRequestDocument,
    event: PurchaseRequestRealtimeEvent,
  ) {
    const server = this.realtimeGateway.server;

    if (!server) {
      return;
    }

    const payload: PurchaseRequestChangedPayload = {
      requestId: String(request._id),
      requestCode: request.requestCode,
      event,
      status: request.status,
    };

    const stakeholderIds = this.getStakeholderUserIds(request);

    for (const userId of stakeholderIds) {
      server.to(`user:${userId}`).emit('purchase-request:changed', payload);
    }

    server.to('role:super-admin').emit('purchase-request:changed', payload);
  }

  private getStakeholderUserIds(request: PurchaseRequestDocument): string[] {
    const ids = new Set<string>();

    ids.add(String(request.createdById));

    for (const member of request.commissionMembers ?? []) {
      ids.add(String(member.userId));
    }

    if (request.boss?.userId) {
      ids.add(String(request.boss.userId));
    }

    return [...ids];
  }
}
