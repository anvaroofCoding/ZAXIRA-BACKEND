import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { MongoServerError } from 'mongodb';
import * as path from 'path';
import { Model, PipelineStage, Types } from 'mongoose';
import { UserRole } from '../../common/enums/user-role.enum';
import { appendDateRangeClause } from '../../common/utils/date-range-filter.util';
import { isSuperAdminRole } from '../../common/utils/super-admin.util';
import { PurchaseRequestsEventsService } from '../realtime/purchase-requests-events.service';
import { NotificationsEventsService } from '../notifications/notifications-events.service';
import { UsersService } from '../users/users.service';
import { ConfirmBossDecisionDto } from './dto/confirm-boss-decision.dto';
import { CreatePurchaseRequestDto } from './dto/create-purchase-request.dto';
import { HISTORY_STEP_TYPE_LABELS } from './constants/history-step-labels';
import { QueryApprovalInboxDto } from './dto/query-approval-inbox.dto';
import { QueryPurchasingInboxDto } from './dto/query-purchasing-inbox.dto';
import { QueryPurchaseRequestHistoryDto } from './dto/query-purchase-request-history.dto';
import { QueryPurchaseRequestsDto } from './dto/query-purchase-requests.dto';
import { ResubmitPurchaseRequestDto } from './dto/resubmit-purchase-request.dto';
import { SubmitApprovalDecisionDto } from './dto/submit-approval-decision.dto';
import {
  APPROVAL_DECISION_LABELS,
  ApprovalDecision,
} from './enums/approval-decision.enum';
import {
  PURCHASE_REQUEST_STATUS_LABELS,
  PurchaseRequestStatus,
} from './enums/purchase-request-status.enum';
import {
  HistoryStepEmbeddable,
  HistoryStepType,
} from './schemas/history-step.schema';
import { MemberDecisionEmbeddable } from './schemas/member-decision.schema';
import {
  PurchaseRequest,
  PurchaseRequestDocument,
} from './schemas/purchase-request.schema';
import { Sequence, SequenceDocument } from './schemas/sequence.schema';
import { PurchaseDetailsEmbeddable } from './schemas/purchase-details.schema';
import { UserSnapshotEmbeddable } from './schemas/user-snapshot.schema';
import { PurchaseRequestFilesService } from './purchase-request-files.service';
import { CompletePurchaseInput } from './types/complete-purchase-input.type';
import {
  formatRequestCode,
  GENERAL_SEQUENCE_KEY,
  NUMBER_SEQUENCE_KEY,
  structureSequenceKey,
} from './utils/request-code.util';

@Injectable()
export class PurchaseRequestsService {
  constructor(
    @InjectModel(PurchaseRequest.name)
    private readonly purchaseRequestModel: Model<PurchaseRequestDocument>,
    @InjectModel(Sequence.name)
    private readonly sequenceModel: Model<SequenceDocument>,
    private readonly usersService: UsersService,
    private readonly purchaseRequestsEvents: PurchaseRequestsEventsService,
    private readonly notificationsEvents: NotificationsEventsService,
    private readonly purchaseRequestFilesService: PurchaseRequestFilesService,
  ) {}

  private emitPurchaseRequestChanged(
    request: PurchaseRequestDocument,
    event: 'created' | 'updated',
  ) {
    this.purchaseRequestsEvents.notifyChanged(request, event);
    void this.notificationsEvents.handlePurchaseRequestChanged(request, event);
  }

  private async nextRequestCode(structureShortName?: string | null, structureId?: string | null) {
    const sequenceKey = structureId
      ? structureSequenceKey(structureId)
      : GENERAL_SEQUENCE_KEY;

    const sequence = await this.sequenceModel
      .findOneAndUpdate(
        { key: sequenceKey },
        { $inc: { value: 1 } },
        { upsert: true, new: true },
      )
      .exec();

    return formatRequestCode(structureShortName, sequence.value);
  }

  private async nextNumber() {
    const sequence = await this.sequenceModel
      .findOneAndUpdate(
        { key: NUMBER_SEQUENCE_KEY },
        { $inc: { value: 1 } },
        { upsert: true, new: true },
      )
      .exec();

    return sequence.value;
  }

  private async buildUserSnapshots(userIds: string[]) {
    const uniqueIds = [...new Set(userIds)];
    const snapshots: UserSnapshotEmbeddable[] = [];

    for (const id of uniqueIds) {
      const user = await this.usersService.findByIdOrFail(id);

      if (!user.isActive) {
        throw new BadRequestException(
          `Nofaol foydalanuvchi tanlangan: ${user.displayName || user.login}`,
        );
      }

      const structure =
        await this.usersService.resolveStructureSnapshotForUser(id);

      snapshots.push({
        userId: new Types.ObjectId(user.id),
        displayName: user.displayName || user.login,
        login: user.login,
        structureShortName: structure?.shortName,
      });
    }

    return snapshots;
  }

  private buildMemberDecisions(
    commissionMembers: UserSnapshotEmbeddable[],
  ): MemberDecisionEmbeddable[] {
    return commissionMembers.map((member) => ({
      userId: member.userId,
      displayName: member.displayName,
      login: member.login,
      structureShortName: member.structureShortName,
      comment: '',
    }));
  }

  private clearBossDecision(request: PurchaseRequestDocument) {
    request.set('bossDecision', undefined);
    request.set('bossConfirmedAt', undefined);
    request.bossConfirmComment = '';
  }

  /** Yangi bosqichda eski boshliq qarorini ko‘rsatmaslik (DB da qolgan bo‘lsa ham). */
  private shouldExposeBossDecision(request: PurchaseRequestDocument): boolean {
    if (!request.bossDecision) {
      return false;
    }

    if (request.status === PurchaseRequestStatus.BOSS_DECISION_PENDING) {
      return false;
    }

    if (
      request.status === PurchaseRequestStatus.COMMISSION_REVIEW &&
      request.resubmittedAfterPartialAt
    ) {
      return false;
    }

    return true;
  }

  /** Qayta yuborishda faqat to‘liq «Tasdiqlash» berganlar qarorini saqlaydi. */
  private preserveMemberDecisionsAfterResubmit(
    request: PurchaseRequestDocument,
  ): MemberDecisionEmbeddable[] {
    const existing = request.memberDecisions ?? [];

    return request.commissionMembers.map((member) => {
      const prior = existing.find(
        (decision) => String(decision.userId) === String(member.userId),
      );

      if (prior?.decision === ApprovalDecision.APPROVED) {
        return {
          userId: member.userId,
          displayName: prior.displayName || member.displayName,
          login: prior.login || member.login,
          structureShortName:
            prior.structureShortName ?? member.structureShortName,
          decision: prior.decision,
          comment: prior.comment ?? '',
          decidedAt: prior.decidedAt,
        };
      }

      return {
        userId: member.userId,
        displayName: member.displayName,
        login: member.login,
        structureShortName: member.structureShortName,
        comment: '',
      };
    });
  }

  private buildSubmittedHistoryStep(
    applicant: UserSnapshotEmbeddable,
    comment?: string,
  ): HistoryStepEmbeddable {
    return {
      type: HistoryStepType.SUBMITTED,
      actorUserId: applicant.userId,
      actorDisplayName: applicant.displayName,
      actorLogin: applicant.login,
      comment: comment?.trim() ?? '',
      createdAt: new Date(),
    };
  }

  private ensureLegacyFields(request: PurchaseRequestDocument) {
    if (!request.status) {
      request.status = PurchaseRequestStatus.COMMISSION_REVIEW;
    }

    if (!request.memberDecisions?.length) {
      request.memberDecisions = this.buildMemberDecisions(
        request.commissionMembers ?? [],
      );
    }

    if (!request.history?.length) {
      request.history = [
        this.buildSubmittedHistoryStep(request.applicant, request.comment),
      ];
    }
  }

  private recomputeStatus(request: PurchaseRequestDocument): PurchaseRequestStatus {
    if (request.status === PurchaseRequestStatus.REJECTED) {
      return PurchaseRequestStatus.REJECTED;
    }

    if (request.status === PurchaseRequestStatus.PURCHASING) {
      return PurchaseRequestStatus.PURCHASING;
    }

    if (request.status === PurchaseRequestStatus.PURCHASED) {
      return PurchaseRequestStatus.PURCHASED;
    }

    if (request.status === PurchaseRequestStatus.WAREHOUSE_IN_TRANSIT) {
      return PurchaseRequestStatus.WAREHOUSE_IN_TRANSIT;
    }

    if (request.status === PurchaseRequestStatus.WAREHOUSE_COMPLETED) {
      return PurchaseRequestStatus.WAREHOUSE_COMPLETED;
    }

    const votes = request.memberDecisions ?? [];

    if (
      votes.some((vote) => vote.decision === ApprovalDecision.REJECTED)
    ) {
      return PurchaseRequestStatus.REJECTED;
    }

    const hasPartial = votes.some(
      (vote) => vote.decision === ApprovalDecision.PARTIAL,
    );

    if (hasPartial && !request.resubmittedAfterPartialAt) {
      return PurchaseRequestStatus.PARTIAL_REVISION;
    }

    const allVoted = votes.length > 0 && votes.every((vote) => vote.decision);

    if (!allVoted) {
      return PurchaseRequestStatus.COMMISSION_REVIEW;
    }

    return PurchaseRequestStatus.BOSS_DECISION_PENDING;
  }

  private isCommissionReviewOpen(request: PurchaseRequestDocument) {
    return (
      request.status === PurchaseRequestStatus.COMMISSION_REVIEW ||
      (request.status === PurchaseRequestStatus.PARTIAL_REVISION &&
        !request.resubmittedAfterPartialAt)
    );
  }

  private isCommissionMember(request: PurchaseRequestDocument, userId: string) {
    return request.commissionMembers.some(
      (member) => String(member.userId) === userId,
    );
  }

  private isBoss(request: PurchaseRequestDocument, userId: string) {
    return String(request.boss.userId) === userId;
  }

  private canAccessRequest(
    request: PurchaseRequestDocument,
    userId: string,
    role?: UserRole,
  ) {
    if (isSuperAdminRole(role)) {
      return true;
    }

    return (
      String(request.createdById) === userId ||
      this.isCommissionMember(request, userId) ||
      this.isBoss(request, userId)
    );
  }

  private assertCanAccess(
    request: PurchaseRequestDocument,
    userId: string,
    role?: UserRole,
  ) {
    if (!this.canAccessRequest(request, userId, role)) {
      throw new ForbiddenException('Ushbu arizaga kirish huquqi yo‘q');
    }
  }

  private getViewerRole(request: PurchaseRequestDocument, userId: string) {
    if (String(request.createdById) === userId) return 'applicant' as const;
    if (this.isBoss(request, userId)) return 'boss' as const;
    if (this.isCommissionMember(request, userId)) return 'commission' as const;
    return null;
  }

  private toPublic(
    request: PurchaseRequestDocument,
    viewerUserId?: string,
    warehouseMeta?: {
      canDispatchToWarehouse?: boolean;
      warehouseDispatch?: {
        id: string;
        dispatchCode: string;
        status: string;
        statusLabel: string;
        targetStructureShortName: string;
      } | null;
      warehouseReceipt?: {
        dispatchCode: string;
        dispatchedAt: Date;
        dispatchedBy: { displayName: string; login: string };
        targetStructure: { shortName: string; fullName: string };
        items: Array<{
          itemIndex: number;
          name: string;
          characteristics: string;
          quantityDispatched: number;
          quantityReceived: number;
          quantityRejected: number;
          quantityPending: number;
          rejectReason: string | null;
        }>;
      } | null;
    },
  ) {
    this.ensureLegacyFields(request);

    const viewerRole = viewerUserId
      ? this.getViewerRole(request, viewerUserId)
      : null;

    const myDecision = viewerUserId
      ? request.memberDecisions?.find(
          (decision) => String(decision.userId) === viewerUserId,
        )
      : undefined;

    const canSubmitDecision =
      viewerRole === 'commission' &&
      this.isCommissionReviewOpen(request) &&
      !myDecision?.decision;

    const canConfirmBossDecision =
      viewerRole === 'boss' &&
      request.status === PurchaseRequestStatus.BOSS_DECISION_PENDING;

    const canResubmit =
      viewerRole === 'applicant' &&
      request.status === PurchaseRequestStatus.PARTIAL_REVISION;

    return {
      id: request.id,
      requestCode: request.requestCode,
      status: request.status,
      statusLabel:
        PURCHASE_REQUEST_STATUS_LABELS[request.status] ?? 'Nomaʼlum holat',
      commissionMembers: request.commissionMembers.map((member) => ({
        userId: String(member.userId),
        displayName: member.displayName,
        login: member.login,
        structureShortName: member.structureShortName ?? null,
      })),
      boss: {
        userId: String(request.boss.userId),
        displayName: request.boss.displayName,
        login: request.boss.login,
      },
      items: request.items.map((item) => ({
        name: item.name,
        characteristics: item.characteristics,
        quantity: item.quantity,
        purchaseAmount: item.purchaseAmount ?? null,
      })),
      comment: request.comment,
      applicant: {
        userId: String(request.applicant.userId),
        displayName: request.applicant.displayName,
        login: request.applicant.login,
      },
      applicantStructure: request.applicantStructure
        ? {
            structureId: String(request.applicantStructure.structureId),
            fullName: request.applicantStructure.fullName,
            shortName: request.applicantStructure.shortName,
            capturedAt: request.applicantStructure.capturedAt,
          }
        : null,
      memberDecisions: (request.memberDecisions ?? []).map((decision) => ({
        userId: String(decision.userId),
        displayName: decision.displayName,
        login: decision.login,
        structureShortName: decision.structureShortName ?? null,
        decision: decision.decision ?? null,
        decisionLabel: decision.decision
          ? APPROVAL_DECISION_LABELS[decision.decision]
          : null,
        comment: decision.comment,
        decidedAt: decision.decidedAt ?? null,
      })),
      history: (request.history ?? []).map((step) => ({
        type: step.type,
        actor: {
          userId: String(step.actorUserId),
          displayName: step.actorDisplayName,
          login: step.actorLogin,
        },
        decision: step.decision ?? null,
        decisionLabel: step.decision
          ? APPROVAL_DECISION_LABELS[step.decision]
          : null,
        comment: step.comment,
        createdAt: step.createdAt,
      })),
      bossConfirmedAt: this.shouldExposeBossDecision(request)
        ? (request.bossConfirmedAt ?? null)
        : null,
      bossDecision: this.shouldExposeBossDecision(request)
        ? (request.bossDecision ?? null)
        : null,
      bossDecisionLabel: this.shouldExposeBossDecision(request)
        ? APPROVAL_DECISION_LABELS[request.bossDecision!]
        : null,
      bossConfirmComment: this.shouldExposeBossDecision(request)
        ? (request.bossConfirmComment ?? '')
        : '',
      resubmittedAfterPartialAt: request.resubmittedAfterPartialAt ?? null,
      viewerRole,
      canSubmitDecision,
      canConfirmBossDecision,
      canResubmit,
      canCompletePurchase:
        request.status === PurchaseRequestStatus.PURCHASING && !request.purchase,
      purchase: request.purchase ? this.mapPurchasePublic(request.purchase) : null,
      // purchase.itemAmounts historically stores per-unit price; total = unitPrice * quantity
      purchaseTotalAmount: request.purchase
        ? request.items.reduce((sum, item) => {
            const unit = item.purchaseAmount ?? 0;
            return sum + unit * item.quantity;
          }, 0)
        : null,
      canDispatchToWarehouse: warehouseMeta?.canDispatchToWarehouse ?? false,
      warehouseDispatch: warehouseMeta?.warehouseDispatch ?? null,
      warehouseReceipt: warehouseMeta?.warehouseReceipt ?? null,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    };
  }

  buildWarehouseMetaFromDispatch(
    request: PurchaseRequestDocument,
    dispatch?: {
      id: string;
      dispatchCode: string;
      status: string;
      targetStructure: { shortName: string };
      receipt?: {
        dispatchCode: string;
        dispatchedAt: Date;
        dispatchedBy: { displayName: string; login: string };
        targetStructure: { shortName: string; fullName: string };
        items: Array<{
          itemIndex: number;
          name: string;
          characteristics: string;
          quantityDispatched: number;
          quantityReceived: number;
          quantityRejected: number;
          quantityPending: number;
          rejectReason: string | null;
        }>;
      };
    } | null,
  ) {
    const canDispatchToWarehouse =
      request.status === PurchaseRequestStatus.PURCHASED && !dispatch;

    return {
      canDispatchToWarehouse,
      warehouseDispatch: dispatch
        ? {
            id: dispatch.id,
            dispatchCode: dispatch.dispatchCode,
            status: dispatch.status,
            statusLabel:
              dispatch.status === 'PENDING_RECEIPT'
                ? 'Qabul kutilmoqda'
                : dispatch.status === 'PARTIALLY_RECEIVED'
                  ? 'Qisman qabul qilindi'
                  : 'Qabul qilindi',
            targetStructureShortName: dispatch.targetStructure.shortName,
          }
        : null,
      warehouseReceipt: dispatch?.receipt ?? null,
    };
  }

  private mapPurchasePublic(purchase: PurchaseDetailsEmbeddable) {
    return {
      vendorName: purchase.vendorName,
      links: purchase.links.map((link) => ({
        label: link.label || '',
        url: link.url,
      })),
      files: purchase.files.map((file) => ({
        label: file.label,
        storedName: file.storedName,
        originalName: file.originalName,
        mimeType: file.mimeType,
        size: file.size,
      })),
      comment: purchase.comment,
      itemAmounts: purchase.itemAmounts.map((row) => ({
        itemIndex: row.itemIndex,
        amount: row.amount,
      })),
      purchasedBy: {
        userId: String(purchase.purchasedById),
        displayName: purchase.purchasedByDisplayName,
        login: purchase.purchasedByLogin,
      },
      purchasedAt: purchase.purchasedAt,
    };
  }

  private buildPurchasingStatusFilter(
    status: PurchaseRequestStatus,
    search?: string,
  ): Record<string, unknown> {
    const clauses: Record<string, unknown>[] = [{ status }];

    const term = search?.trim();

    if (term) {
      clauses.push({ $or: this.buildSearchOr(term) });
    }

    return clauses.length === 1 ? clauses[0] : { $and: clauses };
  }

  private assertPurchasingView(request: PurchaseRequestDocument) {
    const allowed = [
      PurchaseRequestStatus.PURCHASING,
      PurchaseRequestStatus.PURCHASED,
      PurchaseRequestStatus.WAREHOUSE_IN_TRANSIT,
      PurchaseRequestStatus.WAREHOUSE_COMPLETED,
    ];

    if (!allowed.includes(request.status)) {
      throw new ForbiddenException(
        'Ushbu ariza xarid qilish bo‘limida ko‘rinmaydi',
      );
    }
  }

  private buildSearchOr(term: string) {
      const regex = new RegExp(
        term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        'i',
      );

    return [
        { requestCode: regex },
        { comment: regex },
        { 'items.name': regex },
        { 'items.characteristics': regex },
        { 'boss.displayName': regex },
        { 'commissionMembers.displayName': regex },
        { 'applicant.displayName': regex },
        { 'applicantStructure.fullName': regex },
        { 'applicantStructure.shortName': regex },
      ];
  }

  private buildListFilter(
    query: QueryPurchaseRequestsDto,
    userId: string,
    role?: UserRole,
  ): Record<string, unknown> {
    const filter: Record<string, unknown> = {};

    if (!isSuperAdminRole(role)) {
      filter.createdById = new Types.ObjectId(userId);
    }

    const term = query.search?.trim();

    if (term) {
      filter.$or = this.buildSearchOr(term);
    }

    return filter;
  }

  private buildAccessibleRequestsFilter(userId: string, role?: UserRole) {
    if (isSuperAdminRole(role)) {
      return {};
    }

    const userObjectId = new Types.ObjectId(userId);

    return {
      $or: [
        { createdById: userObjectId },
        { 'commissionMembers.userId': userObjectId },
        { 'boss.userId': userObjectId },
      ],
    };
  }

  async findHistoryEventsPaginated(
    query: QueryPurchaseRequestHistoryDto,
    userId: string,
    role?: UserRole,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;

    const preMatchClauses: Record<string, unknown>[] = [];

    const accessFilter = this.buildAccessibleRequestsFilter(userId, role);
    if (Object.keys(accessFilter).length) {
      preMatchClauses.push(accessFilter);
    }

    preMatchClauses.push({ 'history.0': { $exists: true } });

    if (query.status) {
      preMatchClauses.push({ status: query.status });
    }

    const preMatch =
      preMatchClauses.length === 1
        ? preMatchClauses[0]
        : { $and: preMatchClauses };

    const postUnwindClauses: Record<string, unknown>[] = [];

    if (query.eventType) {
      postUnwindClauses.push({ 'history.type': query.eventType });
    }

    const term = query.search?.trim();
    if (term) {
      const regex = new RegExp(
        term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        'i',
      );

      postUnwindClauses.push({
        $or: [
          { requestCode: regex },
          { 'applicant.displayName': regex },
          { 'applicant.login': regex },
          { 'history.actorDisplayName': regex },
          { 'history.actorLogin': regex },
          { 'history.comment': regex },
        ],
      });
    }

    const pipeline: PipelineStage[] = [
      { $match: preMatch },
      { $unwind: '$history' },
    ];

    if (postUnwindClauses.length) {
      pipeline.push({
        $match:
          postUnwindClauses.length === 1
            ? postUnwindClauses[0]
            : { $and: postUnwindClauses },
      });
    }

    pipeline.push(
      { $sort: { 'history.createdAt': -1 } },
      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [
            { $skip: skip },
            { $limit: limit },
            {
              $project: {
                _id: 0,
                requestId: { $toString: '$_id' },
                requestCode: 1,
                requestStatus: '$status',
                eventType: '$history.type',
                eventAt: '$history.createdAt',
                actorDisplayName: '$history.actorDisplayName',
                actorLogin: '$history.actorLogin',
                decision: '$history.decision',
                comment: '$history.comment',
                applicantDisplayName: '$applicant.displayName',
                applicantLogin: '$applicant.login',
              },
            },
          ],
        },
      },
    );

    const [aggregateResult] = await this.purchaseRequestModel
      .aggregate(pipeline)
      .exec();

    const total = aggregateResult?.metadata?.[0]?.total ?? 0;
    const rows = aggregateResult?.data ?? [];

    return {
      items: rows.map(
        (row: {
          requestId: string;
          requestCode: string;
          requestStatus: PurchaseRequestStatus;
          eventType: HistoryStepType;
          eventAt: Date;
          actorDisplayName: string;
          actorLogin: string;
          decision?: ApprovalDecision;
          comment?: string;
          applicantDisplayName: string;
          applicantLogin: string;
        }) => ({
          id: `${row.requestId}-${new Date(row.eventAt).getTime()}`,
          requestId: row.requestId,
          requestCode: row.requestCode,
          requestStatus: row.requestStatus,
          requestStatusLabel:
            PURCHASE_REQUEST_STATUS_LABELS[row.requestStatus] ??
            row.requestStatus,
          eventType: row.eventType,
          eventTypeLabel:
            HISTORY_STEP_TYPE_LABELS[row.eventType] ?? row.eventType,
          eventAt: row.eventAt,
          decision: row.decision ?? null,
          decisionLabel: row.decision
            ? APPROVAL_DECISION_LABELS[row.decision]
            : null,
          comment: row.comment ?? '',
          actor: {
            displayName: row.actorDisplayName,
            login: row.actorLogin,
          },
          applicant: {
            displayName: row.applicantDisplayName,
            login: row.applicantLogin,
          },
        }),
      ),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  private buildApprovalInboxFilter(
    query: QueryApprovalInboxDto,
    userId: string,
    role?: UserRole,
  ): Record<string, unknown> {
    const clauses: Record<string, unknown>[] = [];

    if (!isSuperAdminRole(role)) {
      const userObjectId = new Types.ObjectId(userId);
      clauses.push({
        $or: [
          { 'commissionMembers.userId': userObjectId },
          { 'boss.userId': userObjectId },
        ],
      });
      clauses.push({ createdById: { $ne: userObjectId } });
    }

    const term = query.search?.trim();

    if (term) {
      clauses.push({ $or: this.buildSearchOr(term) });
    }

    if (!clauses.length) {
      return {};
    }

    if (clauses.length === 1) {
      return clauses[0];
    }

    return { $and: clauses };
  }

  async findAllPaginated(
    query: QueryPurchaseRequestsDto,
    userId: string,
    role?: UserRole,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const filter = this.buildListFilter(query, userId, role);
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.purchaseRequestModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.purchaseRequestModel.countDocuments(filter).exec(),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
      items: items.map((item) => this.toPublic(item, userId)),
      total,
      page,
      limit,
      totalPages,
    };
  }

  async findApprovalInboxPaginated(
    query: QueryApprovalInboxDto,
    userId: string,
    role?: UserRole,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const filter = this.buildApprovalInboxFilter(query, userId, role);
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.purchaseRequestModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.purchaseRequestModel.countDocuments(filter).exec(),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
      items: items.map((item) => this.toPublic(item, userId)),
      total,
      page,
      limit,
      totalPages,
    };
  }

  async findByIdOrFail(
    id: string,
    userId?: string,
    role?: UserRole,
    options?: { purchasingView?: boolean },
  ) {
    const request = await this.purchaseRequestModel.findById(id).exec();

    if (!request) {
      throw new NotFoundException('Ariza topilmadi');
    }

    this.ensureLegacyFields(request);

    if (userId) {
      if (options?.purchasingView) {
        this.assertPurchasingView(request);
      } else {
        this.assertCanAccess(request, userId, role);
      }
    }

    return request;
  }

  async findByIdPublic(
    id: string,
    userId: string,
    role?: UserRole,
    options?: { purchasingView?: boolean },
    warehouseDispatch?: Parameters<
      typeof this.buildWarehouseMetaFromDispatch
    >[1],
  ) {
    const request = await this.findByIdOrFail(id, userId, role, options);

    const meta =
      warehouseDispatch !== undefined
        ? this.buildWarehouseMetaFromDispatch(request, warehouseDispatch)
        : undefined;

    return this.toPublic(request, userId, meta);
  }

  async findPurchasingInboxPaginated(
    query: QueryPurchasingInboxDto,
    userId: string,
    role?: UserRole,
    dispatchLoader?: (ids: string[]) => Promise<Map<string, unknown>>,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const filter = this.buildPurchasingInboxFilter(query);
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.purchaseRequestModel
        .find(filter)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.purchaseRequestModel.countDocuments(filter).exec(),
    ]);

    const dispatchMap = dispatchLoader
      ? await dispatchLoader(items.map((item) => String(item._id)))
      : new Map();

    return {
      items: items.map((item) =>
        this.toPublic(
          item,
          userId,
          this.buildWarehouseMetaFromDispatch(
            item,
            dispatchMap.get(String(item._id)) as Parameters<
              typeof this.buildWarehouseMetaFromDispatch
            >[1],
          ),
        ),
      ),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  private buildPurchasingInboxFilter(query: QueryPurchasingInboxDto): Record<string, unknown> {
    const clauses: Record<string, unknown>[] = [
      {
        status: {
          $in: [
            PurchaseRequestStatus.PURCHASING,
            PurchaseRequestStatus.PURCHASED,
            PurchaseRequestStatus.WAREHOUSE_IN_TRANSIT,
            PurchaseRequestStatus.WAREHOUSE_COMPLETED,
          ],
        },
      },
    ];

    appendDateRangeClause(clauses, 'updatedAt', query.dateFrom, query.dateTo);

    const term = query.search?.trim();

    if (term) {
      clauses.push({ $or: this.buildSearchOr(term) });
    }

    return clauses.length === 1 ? clauses[0] : { $and: clauses };
  }

  private buildPurchasedInboxFilter(query: QueryPurchasingInboxDto): Record<string, unknown> {
    const clauses: Record<string, unknown>[] = [
      { status: PurchaseRequestStatus.WAREHOUSE_COMPLETED },
    ];

    appendDateRangeClause(
      clauses,
      'purchase.purchasedAt',
      query.dateFrom,
      query.dateTo,
    );

    const term = query.search?.trim();

    if (term) {
      clauses.push({ $or: this.buildSearchOr(term) });
    }

    return clauses.length === 1 ? clauses[0] : { $and: clauses };
  }

  async findPurchasedInboxPaginated(
    query: QueryPurchasingInboxDto,
    userId: string,
    role?: UserRole,
    dispatchLoader?: (ids: string[]) => Promise<Map<string, unknown>>,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const filter = this.buildPurchasedInboxFilter(query);
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.purchaseRequestModel
        .find(filter)
        .sort({ 'purchase.purchasedAt': -1, updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.purchaseRequestModel.countDocuments(filter).exec(),
    ]);

    const dispatchMap = dispatchLoader
      ? await dispatchLoader(items.map((item) => String(item._id)))
      : new Map();

    return {
      items: items.map((item) =>
        this.toPublic(
          item,
          userId,
          this.buildWarehouseMetaFromDispatch(
            item,
            dispatchMap.get(String(item._id)) as Parameters<
              typeof this.buildWarehouseMetaFromDispatch
            >[1],
          ),
        ),
      ),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async getPurchaseFile(
    requestId: string,
    storedName: string,
    userId: string,
    role?: UserRole,
  ) {
    const request = await this.findByIdOrFail(requestId, userId, role, {
      purchasingView: true,
    });

    const file = request.purchase?.files.find(
      (entry) => entry.storedName === path.basename(storedName),
    );

    if (!file) {
      throw new NotFoundException('Fayl topilmadi');
    }

    const filePath = this.purchaseRequestFilesService.resolveStoredPath(
      requestId,
      file.storedName,
    );

    return { file, filePath };
  }

  async completePurchase(
    id: string,
    input: CompletePurchaseInput,
    files: Express.Multer.File[],
    userId: string,
    role?: UserRole,
  ) {
    const request = await this.findByIdOrFail(id, userId, role, {
      purchasingView: true,
    });

    if (request.status !== PurchaseRequestStatus.PURCHASING) {
      throw new BadRequestException(
        'Faqat sotib olinadigan bosqichdagi arizani xarid qilish mumkin',
      );
    }

    const vendorName = input.vendorName.trim();

    if (vendorName.length < 2) {
      throw new BadRequestException('Firma nomi kamida 2 belgidan iborat bo‘lishi kerak');
    }

    const links = (input.links ?? [])
      .map((link) => ({
        label: link.label?.trim() ?? '',
        url: link.url?.trim() ?? '',
      }))
      .filter((link) => link.url.length > 0);

    for (const link of links) {
      try {
        // eslint-disable-next-line no-new
        new URL(link.url);
      } catch {
        throw new BadRequestException(`Noto‘g‘ri havola: ${link.url}`);
      }
    }

    if (input.itemAmounts.length !== request.items.length) {
      throw new BadRequestException('Har bir tovar uchun summa kiritilishi shart');
    }

    const amountByIndex = new Map<number, number>();

    for (const row of input.itemAmounts) {
      if (
        row.itemIndex < 0 ||
        row.itemIndex >= request.items.length ||
        !Number.isFinite(row.amount) ||
        row.amount < 1
      ) {
        throw new BadRequestException('Tovar summalari noto‘g‘ri');
      }

      amountByIndex.set(row.itemIndex, Math.round(row.amount));
    }

    if (amountByIndex.size !== request.items.length) {
      throw new BadRequestException('Har bir tovar uchun bitta summa bo‘lishi kerak');
    }

    const purchaser = await this.usersService.findByIdOrFail(userId);
    const now = new Date();
    const savedFiles = await this.purchaseRequestFilesService.saveUploadedFiles(
      String(request._id),
      files,
      input.fileLabels ?? [],
    );

    request.items.forEach((item, index) => {
      item.purchaseAmount = amountByIndex.get(index)!;
    });
    request.markModified('items');

    request.purchase = {
      vendorName,
      links,
      files: savedFiles,
      comment: input.comment?.trim() ?? '',
      itemAmounts: request.items.map((item, itemIndex) => ({
        itemIndex,
        amount: item.purchaseAmount!,
      })),
      purchasedById: new Types.ObjectId(userId),
      purchasedByDisplayName: purchaser.displayName || purchaser.login,
      purchasedByLogin: purchaser.login,
      purchasedAt: now,
    };

    request.status = PurchaseRequestStatus.PURCHASED;

    request.history.push({
      type: HistoryStepType.PURCHASED,
      actorUserId: new Types.ObjectId(userId),
      actorDisplayName: purchaser.displayName || purchaser.login,
      actorLogin: purchaser.login,
      comment: input.comment?.trim() ?? '',
      createdAt: now,
    });
    request.markModified('history');

    await request.save();

    this.emitPurchaseRequestChanged(request, 'updated');

    return this.toPublic(request, userId);
  }

  async create(dto: CreatePurchaseRequestDto, createdById: string) {
    if (dto.commissionMemberIds.includes(dto.bossId)) {
      throw new BadRequestException(
        'Boshliq komissiya a’zolari ro‘yxatida bo‘lmasligi kerak',
      );
    }

    const applicantUser = await this.usersService.findByIdOrFail(createdById);
    const applicantSnapshot: UserSnapshotEmbeddable = {
      userId: new Types.ObjectId(applicantUser.id),
      displayName: applicantUser.displayName || applicantUser.login,
      login: applicantUser.login,
    };

    const applicantStructure =
      await this.usersService.resolveStructureSnapshotForUser(createdById);

    const commissionMembers = await this.buildUserSnapshots(
      dto.commissionMemberIds,
    );
    const [boss] = await this.buildUserSnapshots([dto.bossId]);

    const requestCode = await this.nextRequestCode(
      applicantStructure?.shortName,
      applicantStructure?.structureId,
    );

    const number = await this.nextNumber();
    const comment = dto.comment?.trim() ?? '';

    let request: PurchaseRequestDocument;

    try {
      request = await this.purchaseRequestModel.create({
      number,
      requestCode,
      commissionMembers,
      boss,
      items: dto.items.map((item) => ({
        name: item.name.trim(),
        characteristics: item.characteristics.trim(),
        quantity: item.quantity,
      })),
        comment,
      createdById: new Types.ObjectId(createdById),
      applicant: applicantSnapshot,
      applicantStructure: applicantStructure
        ? {
            structureId: new Types.ObjectId(applicantStructure.structureId),
            fullName: applicantStructure.fullName,
            shortName: applicantStructure.shortName,
            capturedAt: applicantStructure.capturedAt,
          }
        : undefined,
        memberDecisions: this.buildMemberDecisions(commissionMembers),
        history: [this.buildSubmittedHistoryStep(applicantSnapshot, comment)],
      });
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        throw new ConflictException(
          'Ariza yaratishda xatolik yuz berdi. Qayta urinib ko‘ring',
        );
      }

      throw error;
    }

    this.emitPurchaseRequestChanged(request, 'created');

    return this.toPublic(request, createdById);
  }

  async submitDecision(
    id: string,
    dto: SubmitApprovalDecisionDto,
    userId: string,
    role?: UserRole,
  ) {
    const request = await this.findByIdOrFail(id, userId, role);

    if (!this.isCommissionMember(request, userId)) {
      throw new ForbiddenException('Faqat komissiya a’zosi qaror berishi mumkin');
    }

    if (request.status === PurchaseRequestStatus.REJECTED) {
      throw new BadRequestException('Rad etilgan arizaga qaror berib bo‘lmaydi');
    }

    if (
      request.status === PurchaseRequestStatus.PURCHASING ||
      request.status === PurchaseRequestStatus.PURCHASED
    ) {
      throw new BadRequestException('Yakunlangan arizaga qaror berib bo‘lmaydi');
    }

    if (!this.isCommissionReviewOpen(request)) {
      throw new BadRequestException(
        'Hozirgi bosqichda komissiya qarori qabul qilinmaydi',
      );
    }

    const decisionIndex = request.memberDecisions.findIndex(
      (decision) => String(decision.userId) === userId,
    );

    if (decisionIndex < 0) {
      throw new ForbiddenException('Siz ushbu arizaning komissiya a’zosi emassiz');
    }

    if (request.memberDecisions[decisionIndex].decision) {
      throw new BadRequestException('Siz allaqachon qaror bergansiz');
    }

    const slot = request.memberDecisions[decisionIndex];
    const comment = dto.comment.trim();
    const now = new Date();

    slot.decision = dto.decision;
    slot.comment = comment;
    slot.decidedAt = now;
    request.markModified('memberDecisions');

    request.history.push({
      type: HistoryStepType.DECISION,
      actorUserId: slot.userId,
      actorDisplayName: slot.displayName,
      actorLogin: slot.login,
      decision: dto.decision,
      comment,
      createdAt: now,
    });
    request.markModified('history');

    if (dto.decision === ApprovalDecision.PARTIAL) {
      request.resubmittedAfterPartialAt = undefined;
    }

    request.status = this.recomputeStatus(request);
    await request.save();

    this.emitPurchaseRequestChanged(request, 'updated');

    return this.toPublic(request, userId);
  }

  async resubmit(
    id: string,
    dto: ResubmitPurchaseRequestDto,
    userId: string,
    role?: UserRole,
  ) {
    const request = await this.findByIdOrFail(id, userId, role);

    if (String(request.createdById) !== userId) {
      throw new ForbiddenException('Faqat ariza beruvchi qayta yuborishi mumkin');
    }

    if (request.status !== PurchaseRequestStatus.PARTIAL_REVISION) {
      throw new BadRequestException(
        'Faqat qisman tasdiqlangan arizani qayta yuborish mumkin',
      );
    }

    const comment = dto.comment?.trim() ?? '';
    const now = new Date();

    request.items = dto.items.map((item) => ({
      name: item.name.trim(),
      characteristics: item.characteristics.trim(),
      quantity: item.quantity,
    }));
    request.comment = comment;
    request.memberDecisions = this.preserveMemberDecisionsAfterResubmit(request);
    request.markModified('memberDecisions');
    this.clearBossDecision(request);
    request.resubmittedAfterPartialAt = now;
    // Komissiya hammasi «Tasdiqlash» bergan bo‘lsa — to‘g‘ridan-to‘g‘ri boshliqqa
    request.status = this.recomputeStatus(request);

    request.history.push({
      type: HistoryStepType.RESUBMITTED,
      actorUserId: request.applicant.userId,
      actorDisplayName: request.applicant.displayName,
      actorLogin: request.applicant.login,
      comment,
      createdAt: now,
    });

    await request.save();

    this.emitPurchaseRequestChanged(request, 'updated');

    return this.toPublic(request, userId);
  }

  async confirmBossDecision(
    id: string,
    dto: ConfirmBossDecisionDto,
    userId: string,
    role?: UserRole,
  ) {
    const request = await this.findByIdOrFail(id, userId, role);

    if (!this.isBoss(request, userId)) {
      throw new ForbiddenException('Faqat boshliq qaror berishi mumkin');
    }

    if (request.status !== PurchaseRequestStatus.BOSS_DECISION_PENDING) {
      throw new BadRequestException(
        'Boshliq qarorini hozirgi bosqichda berib bo‘lmaydi',
      );
    }

    const comment = dto.comment.trim();
    const now = new Date();

    request.bossDecision = dto.decision;
    request.bossConfirmedAt = now;
    request.bossConfirmComment = comment;

    switch (dto.decision) {
      case ApprovalDecision.APPROVED:
        request.status = PurchaseRequestStatus.PURCHASING;
        break;
      case ApprovalDecision.PARTIAL:
        request.status = PurchaseRequestStatus.PARTIAL_REVISION;
        request.resubmittedAfterPartialAt = undefined;
        break;
      case ApprovalDecision.REJECTED:
        request.status = PurchaseRequestStatus.REJECTED;
        break;
      default:
        throw new BadRequestException('Noto‘g‘ri qaror turi');
    }

    request.history.push({
      type: HistoryStepType.BOSS_DECISION,
      actorUserId: request.boss.userId,
      actorDisplayName: request.boss.displayName,
      actorLogin: request.boss.login,
      decision: dto.decision,
      comment,
      createdAt: now,
    });
    request.markModified('history');

    await request.save();

    this.emitPurchaseRequestChanged(request, 'updated');

    return this.toPublic(request, userId);
  }
}
