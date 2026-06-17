import { Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { ApprovalDecision } from '../purchase-requests/enums/approval-decision.enum';
import { PurchaseRequestStatus } from '../purchase-requests/enums/purchase-request-status.enum';
import { PurchaseRequestDocument } from '../purchase-requests/schemas/purchase-request.schema';
import { WarehouseDispatchDocument } from '../warehouse-dispatches/schemas/warehouse-dispatch.schema';
import {
  PERMISSION_CATALOG,
  PermissionCatalogPage,
} from '../users/constants/permission-catalog';
import { UserPermissionsMap } from '../users/types/page-permission.type';
import { UsersService } from '../users/users.service';
import { NotificationType } from './enums/notification-type.enum';
import { CreateNotificationInput } from './notifications.service';
import { NotificationsService } from './notifications.service';

const APPROVAL_PATH = '/xaridlar/arizalarni-tasdiqlash';
const SUBMIT_PATH = '/xaridlar/arizalar-yuborish';
const HISTORY_PATH = '/xaridlar/arizalar-tarixi';
const PURCHASING_PATH = '/xarid-qilish/sotib-olinadigan-tavarlar';
const PURCHASED_PATH = '/xarid-qilish/xarid-qilingan-tavarlar';
const WAREHOUSE_RECEIPT_PATH = '/xarid-qilish/xaridni-qabul-qilish';
const TRANSFER_RECEIPT_PATH = '/transfer/transferni-qabul-qilish';

const PAGE_LABEL_BY_PATH = new Map<string, string>([
  ...PERMISSION_CATALOG.links.map((item) => [item.path, item.label] as const),
  ...PERMISSION_CATALOG.groups.flatMap((group) =>
    group.pages.map((page) => [page.path, page.label] as const),
  ),
]);

@Injectable()
export class NotificationsEventsService {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly usersService: UsersService,
  ) {}

  async notifyPurchaseRequestCommissionRejection(
    request: PurchaseRequestDocument,
  ) {
    const requestId = String(request._id);
    const code = request.requestCode;
    const creatorId = String(request.createdById);

    await this.notificationsService.createMany([
      {
        userId: creatorId,
        type: NotificationType.PURCHASE_REQUEST_STATUS,
        title: 'Arizada tuzatish kerak',
          message: `${code} raqamli arizada rad etildi — tuzatib qayta yuboring`,
        linkPath: SUBMIT_PATH,
        entityId: requestId,
      },
    ]);
  }

  async handlePurchaseRequestChanged(
    request: PurchaseRequestDocument,
    event: 'created' | 'updated',
  ) {
    const requestId = String(request._id);
    const code = request.requestCode;
    const creatorId = String(request.createdById);
    const inputs: CreateNotificationInput[] = [];

    if (event === 'created') {
      for (const member of request.commissionMembers ?? []) {
        const memberId = String(member.userId);
        if (memberId === creatorId) continue;

        inputs.push({
          userId: memberId,
          type: NotificationType.PURCHASE_REQUEST_APPROVAL,
          title: 'Yangi ariza',
          message: `${code} raqamli ariza kelishish uchun kelib tushdi`,
          linkPath: APPROVAL_PATH,
          entityId: requestId,
        });
      }

      await this.notificationsService.createMany(inputs);
      return;
    }

    switch (request.status) {
      case PurchaseRequestStatus.COMMISSION_REVIEW: {
        for (const member of request.commissionMembers ?? []) {
          const memberId = String(member.userId);
          const decision = request.memberDecisions?.find(
            (item) => String(item.userId) === memberId,
          );

          if (
            String(decision?.decision ?? '').toUpperCase() ===
            ApprovalDecision.APPROVED
          ) {
            continue;
          }

          inputs.push({
            userId: memberId,
            type: NotificationType.PURCHASE_REQUEST_APPROVAL,
            title: 'Ariza yangilandi',
            message: `${code} raqamli ariza qayta ko‘rib chiqish uchun keldi`,
            linkPath: APPROVAL_PATH,
            entityId: requestId,
          });
        }
        break;
      }

      case PurchaseRequestStatus.BOSS_DECISION_PENDING: {
        if (request.boss?.userId) {
          inputs.push({
            userId: String(request.boss.userId),
            type: NotificationType.PURCHASE_REQUEST_APPROVAL,
            title: 'Boshliq qarori kerak',
            message: `${code} raqamli ariza boshliq kelishmoqda`,
            linkPath: APPROVAL_PATH,
            entityId: requestId,
          });
        }
        break;
      }

      case PurchaseRequestStatus.PARTIAL_REVISION:
      case PurchaseRequestStatus.REJECTED: {
        inputs.push({
          userId: creatorId,
          type: NotificationType.PURCHASE_REQUEST_STATUS,
          title:
            request.status === PurchaseRequestStatus.REJECTED
              ? 'Ariza rad etildi'
              : 'Arizada tuzatish kerak',
          message:
            request.status === PurchaseRequestStatus.REJECTED
              ? `${code} raqamli ariza rad etildi`
              : `${code} raqamli arizada rad etildi — tuzatib qayta yuboring`,
          linkPath: SUBMIT_PATH,
          entityId: requestId,
        });
        break;
      }

      case PurchaseRequestStatus.PURCHASING: {
        const recipientIds =
          await this.usersService.findActiveUserIdsWithPageAccess(
            PURCHASING_PATH,
          );

        for (const userId of recipientIds) {
          inputs.push({
            userId,
            type: NotificationType.PURCHASE_REQUEST_PURCHASING,
            title: 'Sotib olish navbatiga tushdi',
            message: `${code} raqamli ariza sotib olinadigan maxsulotlar ro‘yxatiga qo‘shildi`,
            linkPath: PURCHASING_PATH,
            entityId: requestId,
          });
        }
        break;
      }

      case PurchaseRequestStatus.PURCHASED: {
        const recipientIds =
          await this.usersService.findActiveUserIdsWithPageAccess(
            PURCHASED_PATH,
          );

        for (const userId of recipientIds) {
          inputs.push({
            userId,
            type: NotificationType.PURCHASE_REQUEST_PURCHASED,
            title: 'Xarid yakunlandi',
            message: `${code} raqamli ariza xarid qilingan tavarlar ro‘yxatiga o‘tdi`,
            linkPath: PURCHASED_PATH,
            entityId: requestId,
          });
        }
        break;
      }

      case PurchaseRequestStatus.WAREHOUSE_COMPLETED: {
        inputs.push({
          userId: creatorId,
          type: NotificationType.PURCHASE_REQUEST_STATUS,
          title: 'Omborga qabul qilindi',
          message: `${code} raqamli ariza bo‘yicha tovarlar omborga qabul qilindi`,
          linkPath: HISTORY_PATH,
          entityId: requestId,
        });
        break;
      }

      default:
        break;
    }

    await this.notificationsService.createMany(inputs);
  }

  async handleTransferCreated(dispatch: WarehouseDispatchDocument) {
    const structureId = this.resolveStructureId(
      dispatch.targetStructure?.structureId,
    );
    const recipientIds =
      await this.usersService.findActiveUserIdsWithPageAccess(
        TRANSFER_RECEIPT_PATH,
        structureId,
      );
    const dispatchId = String(dispatch._id);
    const code = dispatch.requestCode || dispatch.dispatchCode;

    await this.notificationsService.createMany(
      recipientIds.map((userId) => ({
        userId,
        type: NotificationType.TRANSFER_RECEIVED,
        title: 'Yangi transfer',
        message: `${code} raqamli transfer qabul qilish uchun keldi`,
        linkPath: TRANSFER_RECEIPT_PATH,
        entityId: dispatchId,
      })),
    );
  }

  async handleWarehouseReceiptCreated(
    dispatch: WarehouseDispatchDocument,
    requestCode: string,
  ) {
    const structureId = this.resolveStructureId(
      dispatch.targetStructure?.structureId,
    );
    const recipientIds =
      await this.usersService.findActiveUserIdsWithPageAccess(
        WAREHOUSE_RECEIPT_PATH,
        structureId,
      );
    const dispatchId = String(dispatch._id);

    await this.notificationsService.createMany(
      recipientIds.map((userId) => ({
        userId,
        type: NotificationType.WAREHOUSE_RECEIPT,
        title: 'Omborga jo‘natma keldi',
        message: `${requestCode} raqamli ariza bo‘yicha tovarlar qabul qilish uchun keldi`,
        linkPath: WAREHOUSE_RECEIPT_PATH,
        entityId: dispatchId,
      })),
    );
  }

  async handlePermissionsUpdated(
    userId: string,
    previousPermissions: UserPermissionsMap,
    nextPermissions: UserPermissionsMap,
  ) {
    const grantedPages = this.findNewlyGrantedPages(
      previousPermissions,
      nextPermissions,
    );

    if (!grantedPages.length) {
      return;
    }

    const labels = grantedPages
      .map((page) => PAGE_LABEL_BY_PATH.get(page.path) ?? page.path)
      .join(', ');

    await this.notificationsService.createMany([
      {
        userId,
        type: NotificationType.PERMISSIONS_GRANTED,
        title: 'Yangi ruxsat berildi',
        message:
          grantedPages.length === 1
            ? `Sizga «${labels}» bo‘limiga kirish huquqi berildi`
            : `Sizga quyidagi bo‘limlarga kirish huquqi berildi: ${labels}`,
        linkPath: grantedPages[0].path,
        entityId: grantedPages.map((page) => page.path).join(','),
      },
    ]);
  }

  private findNewlyGrantedPages(
    previousPermissions: UserPermissionsMap,
    nextPermissions: UserPermissionsMap,
  ): PermissionCatalogPage[] {
    const pages: PermissionCatalogPage[] = [];

    for (const group of PERMISSION_CATALOG.groups) {
      for (const page of group.pages) {
        const hadAccess = Boolean(previousPermissions?.[page.path]?.access);
        const hasAccess = Boolean(nextPermissions?.[page.path]?.access);

        if (!hadAccess && hasAccess) {
          pages.push(page);
        }
      }
    }

    for (const page of PERMISSION_CATALOG.links) {
      const hadAccess = Boolean(previousPermissions?.[page.path]?.access);
      const hasAccess = Boolean(nextPermissions?.[page.path]?.access);

      if (!hadAccess && hasAccess) {
        pages.push(page);
      }
    }

    return pages;
  }

  private resolveStructureId(value: unknown): string | null {
    if (value == null || value === '') {
      return null;
    }

    if (value instanceof Types.ObjectId) {
      return value.toHexString();
    }

    if (typeof value === 'object' && value !== null && '_id' in value) {
      return this.resolveStructureId(value._id);
    }

    const raw = String(value).trim();
    if (!raw) {
      return null;
    }

    return Types.ObjectId.isValid(raw)
      ? new Types.ObjectId(raw).toHexString()
      : raw;
  }
}
