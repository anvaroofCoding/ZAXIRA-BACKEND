import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
  forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';
import { MongoServerError } from 'mongodb';
import * as path from 'path';
import { Model, PipelineStage, Types } from 'mongoose';
import { UserRole } from '../../common/enums/user-role.enum';
import { appendDateRangeClause } from '../../common/utils/date-range-filter.util';
import { isSuperAdminRole } from '../../common/utils/super-admin.util';
import { PurchaseRequestsEventsService } from '../realtime/purchase-requests-events.service';
import { NotificationsEventsService } from '../notifications/notifications-events.service';
import { UsersService } from '../users/users.service';
import { UserPermissionsMap } from '../users/types/page-permission.type';
import {
  hasPageAction,
  normalizePermissions,
} from '../users/utils/permissions.util';
import {
  PURCHASE_REQUEST_APPROVAL_PATH,
  PURCHASE_REQUEST_SUBMIT_PATH,
} from './purchase-requests.constants';
import { ConfirmBossDecisionDto } from './dto/confirm-boss-decision.dto';
import { CreatePurchaseRequestDto } from './dto/create-purchase-request.dto';
import { SavePurchaseRequestSessionDto } from './dto/save-purchase-request-session.dto';
import { HISTORY_STEP_TYPE_LABELS } from './constants/history-step-labels';
import { QueryApprovalInboxDto } from './dto/query-approval-inbox.dto';
import { QueryPurchasingInboxDto } from './dto/query-purchasing-inbox.dto';
import { QueryPurchaseRequestHistoryDto } from './dto/query-purchase-request-history.dto';
import { QueryPurchaseRequestsDto } from './dto/query-purchase-requests.dto';
import { ResubmitPurchaseRequestDto } from './dto/resubmit-purchase-request.dto';
import { MarkItemsUnavailableDto } from './dto/mark-items-unavailable.dto';
import { RejectPurchaseDto } from './dto/reject-purchase.dto';
import { UpdatePurchaseRequestDto } from './dto/update-purchase-request.dto';
import { PURCHASE_REJECTION_REASON_LABELS } from './constants/purchase-rejection-reasons';
import { SubmitApprovalDecisionDto } from './dto/submit-approval-decision.dto';
import {
  APPROVAL_DECISION_LABELS,
  ApprovalDecision,
  MEMBER_DECISION_PENDING_LABEL,
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
import {
  PurchaseRequestSession,
  PurchaseRequestSessionDocument,
} from './schemas/purchase-request-session.schema';
import { Sequence, SequenceDocument } from './schemas/sequence.schema';
import {
  PurchaseBatchEmbeddable,
  PurchaseDetailsEmbeddable,
  PurchaseUnavailableBatchEmbeddable,
} from './schemas/purchase-details.schema';
import { UserSnapshotEmbeddable } from './schemas/user-snapshot.schema';
import { PurchaseRequestFilesService } from './purchase-request-files.service';
import { PurchaseRequestSessionDocumentsService } from './purchase-request-session-documents.service';
import { WarehouseDispatchesService } from '../warehouse-dispatches/warehouse-dispatches.service';
import { CompletePurchaseInput } from './types/complete-purchase-input.type';
import { PurchaseRequestAiService } from './purchase-request-ai.service';
import {
  formatRequestCode,
  GENERAL_SEQUENCE_KEY,
  NUMBER_SEQUENCE_KEY,
  structureSequenceKey,
} from './utils/request-code.util';
import {
  formatPurchasePeriodLabel,
  normalizePurchasePeriodFields,
  parsePurchasePeriodType,
  resolvePurchasePeriodType,
  validatePurchasePeriod,
} from './utils/purchase-period.util';
import { PurchasePeriodType } from './enums/purchase-period-type.enum';

const PURCHASE_REQUEST_DELETE_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_ACTIVE_SESSIONS_PER_USER = 10;

@Injectable()
export class PurchaseRequestsService implements OnModuleInit {
  private readonly logger = new Logger(PurchaseRequestsService.name);

  constructor(
    @InjectModel(PurchaseRequest.name)
    private readonly purchaseRequestModel: Model<PurchaseRequestDocument>,
    @InjectModel(Sequence.name)
    private readonly sequenceModel: Model<SequenceDocument>,
    @InjectModel(PurchaseRequestSession.name)
    private readonly purchaseRequestSessionModel: Model<PurchaseRequestSessionDocument>,
    private readonly usersService: UsersService,
    private readonly purchaseRequestsEvents: PurchaseRequestsEventsService,
    private readonly notificationsEvents: NotificationsEventsService,
    private readonly purchaseRequestFilesService: PurchaseRequestFilesService,
    @Inject(forwardRef(() => WarehouseDispatchesService))
    private readonly warehouseDispatchesService: WarehouseDispatchesService,
    private readonly purchaseRequestAiService: PurchaseRequestAiService,
    private readonly sessionDocumentsService: PurchaseRequestSessionDocumentsService,
  ) {}

  async onModuleInit() {
    await this.syncPurchaseRequestSessionIndexes();
  }

  private async syncPurchaseRequestSessionIndexes() {
    try {
      const collection = this.purchaseRequestSessionModel.collection;
      const indexes = await collection.indexes();
      const legacyUniqueUserIndex = indexes.find(
        (index) =>
          index.name === 'userId_1' &&
          index.unique &&
          Object.keys(index.key).length === 1 &&
          index.key.userId === 1,
      );

      if (legacyUniqueUserIndex) {
        await collection.dropIndex('userId_1');
        this.logger.warn(
          'purchase_request_sessions: eski unique userId indeksi olib tashlandi',
        );
      }
    } catch (error) {
      this.logger.warn(
        `purchase_request_sessions indekslari sinxronlanmadi: ${String(error)}`,
      );
    }

    try {
      await this.purchaseRequestSessionModel.syncIndexes();
    } catch (error) {
      this.logger.warn(
        `purchase_request_sessions indekslari yaratilmadi: ${String(error)}`,
      );
    }
  }

  private async assertApprovalSubmitPermission(
    userId: string,
    role?: UserRole,
  ) {
    if (isSuperAdminRole(role)) {
      return;
    }

    const user = await this.usersService.findById(userId);
    if (!user?.isActive) {
      throw new ForbiddenException('Qaror berishga ruxsat yo‘q');
    }

    const permissions = normalizePermissions(
      user.permissions as UserPermissionsMap | undefined,
    );
    if (
      !hasPageAction(
        permissions,
        PURCHASE_REQUEST_APPROVAL_PATH,
        'create',
        false,
      )
    ) {
      throw new ForbiddenException('Qaror berishga ruxsat yo‘q');
    }
  }

  private async hasApprovalSubmitPermission(
    userId: string,
    role?: UserRole,
  ): Promise<boolean> {
    if (isSuperAdminRole(role)) {
      return true;
    }

    const user = await this.usersService.findById(userId);
    if (!user?.isActive) {
      return false;
    }

    const permissions = normalizePermissions(
      user.permissions as UserPermissionsMap | undefined,
    );
    return hasPageAction(
      permissions,
      PURCHASE_REQUEST_APPROVAL_PATH,
      'create',
      false,
    );
  }

  private async assertPurchaseRequestDeletePermission(
    userId: string,
    role?: UserRole,
  ) {
    if (isSuperAdminRole(role)) {
      return;
    }

    const user = await this.usersService.findById(userId);
    if (!user?.isActive) {
      throw new ForbiddenException('Arizani o‘chirishga ruxsat yo‘q');
    }

    const permissions = normalizePermissions(
      user.permissions as UserPermissionsMap | undefined,
    );
    if (
      !hasPageAction(permissions, PURCHASE_REQUEST_SUBMIT_PATH, 'delete', false)
    ) {
      throw new ForbiddenException('Arizani o‘chirishga ruxsat yo‘q');
    }
  }

  private async assertPurchaseRequestUpdatePermission(
    userId: string,
    role?: UserRole,
  ) {
    if (await this.isUserElevatedAdmin(userId, role)) {
      return;
    }

    if (!(await this.hasPurchaseRequestMutatePermission(userId, role))) {
      throw new ForbiddenException('Arizani tahrirlashga ruxsat yo‘q');
    }
  }

  private async isUserElevatedAdmin(
    userId: string,
    role?: UserRole,
  ): Promise<boolean> {
    if (isSuperAdminRole(role)) {
      return true;
    }

    try {
      const user = await this.usersService.findById(userId);
      return Boolean(user?.isActive && user.role === UserRole.SUPER_ADMIN);
    } catch {
      return false;
    }
  }

  private async assertCanEditPurchaseRequest(
    request: PurchaseRequestDocument,
    userId: string,
    role?: UserRole,
  ) {
    const isViewerAdmin = await this.isUserElevatedAdmin(userId, role);

    if (!isViewerAdmin && !this.isApplicant(request, userId)) {
      throw new ForbiddenException(
        'Faqat ariza beruvchi yoki admin tahrirlashi mumkin',
      );
    }

    if (!isViewerAdmin && !this.canOpenDocumentEditSession(request)) {
      throw new BadRequestException(
        'Arizani hozirgi holatida tahrirlash mumkin emas',
      );
    }
  }

  private async hasPurchaseRequestCreatePermission(
    userId: string,
    role?: UserRole,
  ): Promise<boolean> {
    if (isSuperAdminRole(role)) {
      return true;
    }

    const user = await this.usersService.findById(userId);
    if (!user?.isActive) {
      return false;
    }

    if (user.role === UserRole.SUPER_ADMIN) {
      return true;
    }

    const permissions = normalizePermissions(
      user.permissions as UserPermissionsMap | undefined,
    );
    return hasPageAction(
      permissions,
      PURCHASE_REQUEST_SUBMIT_PATH,
      'create',
      false,
    );
  }

  private async hasPurchaseRequestMutatePermission(
    userId: string,
    role?: UserRole,
  ): Promise<boolean> {
    const [updateAllowed, createAllowed] = await Promise.all([
      this.hasPurchaseRequestUpdatePermission(userId, role),
      this.hasPurchaseRequestCreatePermission(userId, role),
    ]);

    return updateAllowed || createAllowed;
  }

  private async hasPurchaseRequestUpdatePermission(
    userId: string,
    role?: UserRole,
  ): Promise<boolean> {
    if (isSuperAdminRole(role)) {
      return true;
    }

    const user = await this.usersService.findById(userId);
    if (!user?.isActive) {
      return false;
    }

    if (user.role === UserRole.SUPER_ADMIN) {
      return true;
    }

    const permissions = normalizePermissions(
      user.permissions as UserPermissionsMap | undefined,
    );
    return hasPageAction(
      permissions,
      PURCHASE_REQUEST_SUBMIT_PATH,
      'update',
      false,
    );
  }

  private async hasPurchaseRequestDeletePermission(
    userId: string,
    role?: UserRole,
  ): Promise<boolean> {
    if (isSuperAdminRole(role)) {
      return true;
    }

    const user = await this.usersService.findById(userId);
    if (!user?.isActive) {
      return false;
    }

    const permissions = normalizePermissions(
      user.permissions as UserPermissionsMap | undefined,
    );
    return hasPageAction(
      permissions,
      PURCHASE_REQUEST_SUBMIT_PATH,
      'delete',
      false,
    );
  }

  private emitPurchaseRequestChanged(
    request: PurchaseRequestDocument,
    event: 'created' | 'updated',
  ) {
    this.purchaseRequestsEvents.notifyChanged(request, event);
    void this.notificationsEvents.handlePurchaseRequestChanged(request, event);
  }

  private async isRequestCodeTaken(requestCode: string) {
    const normalized = requestCode.trim().toUpperCase();
    if (!normalized) return false;

    const existing = await this.purchaseRequestModel
      .exists({ requestCode: normalized })
      .exec();

    return Boolean(existing);
  }

  private async allocateUniqueRequestCode(
    structureShortName?: string | null,
    structureId?: string | null,
    maxAttempts = 8,
  ) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const requestCode = await this.nextRequestCode(
        structureShortName,
        structureId,
      );

      if (!(await this.isRequestCodeTaken(requestCode))) {
        return requestCode;
      }
    }

    throw new ConflictException(
      'Ariza raqamini ajratib bo‘lmadi. Qayta urinib ko‘ring',
    );
  }

  private async findRequestCreatedFromSession(
    session: PurchaseRequestSessionDocument,
    userId: string,
    requestCode: string,
  ) {
    if (session.applicantVerificationToken) {
      const byToken = await this.purchaseRequestModel
        .findOne({
          applicantVerificationToken: session.applicantVerificationToken,
        })
        .exec();

      if (byToken) {
        return byToken;
      }
    }

    const normalizedCode = requestCode.trim().toUpperCase();
    if (!normalizedCode) {
      return null;
    }

    const byCode = await this.purchaseRequestModel
      .findOne({ requestCode: normalizedCode })
      .exec();

    if (byCode && String(byCode.createdById) === userId) {
      return byCode;
    }

    return null;
  }

  private async nextRequestCode(
    structureShortName?: string | null,
    structureId?: string | null,
  ) {
    const sequenceKey = structureId
      ? structureSequenceKey(structureId)
      : GENERAL_SEQUENCE_KEY;

    const sequence = await this.sequenceModel
      .findOneAndUpdate(
        { key: sequenceKey },
        { $inc: { value: 1 } },
        { upsert: true, returnDocument: 'after' },
      )
      .exec();

    return formatRequestCode(structureShortName, sequence.value);
  }

  private async nextNumber() {
    const sequence = await this.sequenceModel
      .findOneAndUpdate(
        { key: NUMBER_SEQUENCE_KEY },
        { $inc: { value: 1 } },
        { upsert: true, returnDocument: 'after' },
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
        structureLeaderName: structure?.leaderName?.trim() || '',
        position: user.position?.trim() ?? '',
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
      position: member.position?.trim() ?? '',
      comment: '',
    }));
  }

  private buildMemberDecisionLookup(priorDecisions: MemberDecisionEmbeddable[]) {
    const byUserId = new Map<string, MemberDecisionEmbeddable>();
    const byLogin = new Map<string, MemberDecisionEmbeddable>();

    for (const decision of priorDecisions) {
      const userId = this.normalizeUserId(decision.userId);

      if (userId && !byUserId.has(userId)) {
        byUserId.set(userId, decision);
      }

      const login = decision.login?.trim().toLowerCase();

      if (login && !byLogin.has(login)) {
        byLogin.set(login, decision);
      }
    }

    return { byUserId, byLogin };
  }

  private findPriorMemberDecision(
    member: Pick<UserSnapshotEmbeddable, 'userId' | 'login'>,
    lookup: ReturnType<PurchaseRequestsService['buildMemberDecisionLookup']>,
  ): MemberDecisionEmbeddable | undefined {
    const byUserId = lookup.byUserId.get(this.normalizeUserId(member.userId));

    if (byUserId) {
      return byUserId;
    }

    const login = member.login?.trim().toLowerCase();

    if (login) {
      return lookup.byLogin.get(login);
    }

    return undefined;
  }

  private async loadStoredMemberDecisionsForEdit(
    requestId: string,
  ): Promise<MemberDecisionEmbeddable[]> {
    const row = await this.purchaseRequestModel
      .findById(requestId)
      .select('memberDecisions')
      .lean<{ memberDecisions?: MemberDecisionEmbeddable[] }>()
      .exec();

    return this.snapshotMemberDecisions(row?.memberDecisions ?? []);
  }

  /** Tahrirlashda faqat to‘liq kelishgan (APPROVED) a’zolar qarorini saqlaydi. */
  private preserveMemberDecisionsAfterEdit(
    commissionMembers: UserSnapshotEmbeddable[],
    priorDecisions: MemberDecisionEmbeddable[],
  ): MemberDecisionEmbeddable[] {
    const lookup = this.buildMemberDecisionLookup(priorDecisions);

    return commissionMembers.map((member) => {
      const prior = this.findPriorMemberDecision(member, lookup);

      if (prior && this.isMemberFullyApproved(prior.decision)) {
        return {
          userId: member.userId,
          displayName: prior.displayName || member.displayName,
          login: prior.login || member.login,
          structureShortName:
            prior.structureShortName ?? member.structureShortName,
          position: prior.position ?? member.position,
          decision: ApprovalDecision.APPROVED,
          comment: prior.comment ?? '',
          decidedAt: prior.decidedAt,
        };
      }

      return {
        userId: member.userId,
        displayName: member.displayName,
        login: member.login,
        structureShortName: member.structureShortName,
        position: member.position?.trim() ?? '',
        comment: '',
      };
    });
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

    if (request.bossDecision === ApprovalDecision.APPROVED) {
      return true;
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

  private isApprovalWorkflowClosed(request: PurchaseRequestDocument): boolean {
    if (
      request.bossDecision === ApprovalDecision.APPROVED ||
      request.bossDecision === ApprovalDecision.REJECTED
    ) {
      return true;
    }

    const closedStatuses: PurchaseRequestStatus[] = [
      PurchaseRequestStatus.PURCHASING,
      PurchaseRequestStatus.PURCHASED,
      PurchaseRequestStatus.WAREHOUSE_IN_TRANSIT,
      PurchaseRequestStatus.WAREHOUSE_COMPLETED,
    ];

    return closedStatuses.includes(request.status);
  }

  /** Qayta yuborishda faqat to‘liq kelishgan a’zolar qarorini saqlaydi. */
  private preserveMemberDecisionsAfterResubmit(
    request: PurchaseRequestDocument,
    resubmitToMemberIds: string[],
  ): MemberDecisionEmbeddable[] {
    const existing = request.memberDecisions ?? [];
    const resetIds = new Set(resubmitToMemberIds.map(String));

    return request.commissionMembers.map((member) => {
      const memberId = String(member.userId);
      const prior = existing.find(
        (decision) => String(decision.userId) === memberId,
      );

      if (prior && this.isMemberFullyApproved(prior.decision)) {
        return {
          userId: member.userId,
          displayName: prior.displayName || member.displayName,
          login: prior.login || member.login,
          structureShortName:
            prior.structureShortName ?? member.structureShortName,
          position: prior.position ?? member.position,
          decision: prior.decision,
          comment: prior.comment ?? '',
          decidedAt: prior.decidedAt,
        };
      }

      if (prior?.decision === ApprovalDecision.REJECTED && resetIds.has(memberId)) {
        return {
          userId: member.userId,
          displayName: member.displayName,
          login: member.login,
          structureShortName: member.structureShortName,
          position: member.position,
          comment: '',
        };
      }

      if (prior?.decision === ApprovalDecision.PARTIAL) {
        return {
          userId: member.userId,
          displayName: member.displayName,
          login: member.login,
          structureShortName: member.structureShortName,
          position: member.position,
          comment: '',
        };
      }

      if (prior) {
        return {
          userId: prior.userId,
          displayName: prior.displayName || member.displayName,
          login: prior.login || member.login,
          structureShortName:
            prior.structureShortName ?? member.structureShortName,
          position: prior.position ?? member.position,
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
        position: member.position,
        comment: '',
      };
    });
  }

  private normalizeUserId(userId: unknown): string {
    if (userId == null || userId === '') {
      return '';
    }

    if (userId instanceof Types.ObjectId) {
      return userId.toHexString();
    }

    if (typeof userId === 'object' && userId !== null && '_id' in userId) {
      return this.normalizeUserId((userId as { _id: unknown })._id);
    }

    const raw = String(userId).trim();

    if (Types.ObjectId.isValid(raw)) {
      return new Types.ObjectId(raw).toHexString();
    }

    return raw;
  }

  private isMemberAgreed(decision?: ApprovalDecision | string | null) {
    if (!decision) {
      return false;
    }

    const normalized = String(decision).toUpperCase();

    return (
      normalized === ApprovalDecision.APPROVED ||
      normalized === ApprovalDecision.PARTIAL
    );
  }

  private isMemberFullyApproved(decision?: ApprovalDecision | string | null) {
    return String(decision ?? '').toUpperCase() === ApprovalDecision.APPROVED;
  }

  private snapshotMemberDecisions(
    decisions: MemberDecisionEmbeddable[] = [],
  ): MemberDecisionEmbeddable[] {
    return decisions.map((vote) => ({
      userId: vote.userId,
      displayName: vote.displayName,
      login: vote.login,
      structureShortName: vote.structureShortName,
      position: vote.position,
      decision: vote.decision,
      comment: vote.comment ?? '',
      decidedAt: vote.decidedAt,
    }));
  }

  private syncMemberDecisionsWithCommission(
    request: PurchaseRequestDocument,
  ): void {
    const members = request.commissionMembers ?? [];

    if (!members.length) {
      return;
    }

    const lookup = this.buildMemberDecisionLookup(request.memberDecisions ?? []);

    request.memberDecisions = members.map((member) => {
      const prior = this.findPriorMemberDecision(member, lookup);

      if (prior) {
        return {
          userId: member.userId,
          displayName: prior.displayName || member.displayName,
          login: prior.login || member.login,
          structureShortName:
            prior.structureShortName ?? member.structureShortName,
          position: prior.position ?? member.position,
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
        position: member.position?.trim() ?? '',
        comment: '',
      };
    });
  }

  private getWorkflowStatus(
    request: PurchaseRequestDocument,
  ): PurchaseRequestStatus {
    this.syncMemberDecisionsWithCommission(request);
    return this.recomputeStatus(request);
  }

  private getPublicStatus(request: PurchaseRequestDocument): PurchaseRequestStatus {
    if (request.bossDecision === ApprovalDecision.APPROVED) {
      const postBossApproval: PurchaseRequestStatus[] = [
        PurchaseRequestStatus.PURCHASING,
        PurchaseRequestStatus.PURCHASED,
        PurchaseRequestStatus.WAREHOUSE_IN_TRANSIT,
        PurchaseRequestStatus.WAREHOUSE_COMPLETED,
      ];

      if (postBossApproval.includes(request.status)) {
        return request.status;
      }

      return PurchaseRequestStatus.PURCHASING;
    }

    if (
      request.bossDecision === ApprovalDecision.REJECTED &&
      request.status === PurchaseRequestStatus.REJECTED
    ) {
      return PurchaseRequestStatus.REJECTED;
    }

    const workflowStatus = this.getWorkflowStatus(request);

    if (workflowStatus === PurchaseRequestStatus.BOSS_DECISION_PENDING) {
      return PurchaseRequestStatus.BOSS_DECISION_PENDING;
    }

    if (
      workflowStatus === PurchaseRequestStatus.PARTIAL_REVISION ||
      request.status === PurchaseRequestStatus.PARTIAL_REVISION
    ) {
      return PurchaseRequestStatus.COMMISSION_REVIEW;
    }

    return workflowStatus;
  }

  private areAllCommissionMembersAgreed(request: PurchaseRequestDocument) {
    this.syncMemberDecisionsWithCommission(request);

    const decisions = request.memberDecisions ?? [];

    if (!decisions.length) {
      return false;
    }

    if (
      decisions.some((vote) => vote.decision === ApprovalDecision.REJECTED)
    ) {
      return false;
    }

    const members = request.commissionMembers ?? [];

    if (members.length > 0) {
      const decisionByUserId = new Map(
        decisions.map((vote) => [
          this.normalizeUserId(vote.userId),
          vote.decision,
        ]),
      );

      return members.every((member) =>
        this.isMemberAgreed(
          decisionByUserId.get(this.normalizeUserId(member.userId)),
        ),
      );
    }

    return decisions.every((vote) => this.isMemberAgreed(vote.decision));
  }

  private async reconcileBossApprovedStatus(
    request: PurchaseRequestDocument,
  ): Promise<void> {
    if (request.bossDecision !== ApprovalDecision.APPROVED) {
      return;
    }

    const postBossApproval: PurchaseRequestStatus[] = [
      PurchaseRequestStatus.PURCHASING,
      PurchaseRequestStatus.PURCHASED,
      PurchaseRequestStatus.WAREHOUSE_IN_TRANSIT,
      PurchaseRequestStatus.WAREHOUSE_COMPLETED,
    ];

    if (postBossApproval.includes(request.status)) {
      return;
    }

    request.status = PurchaseRequestStatus.PURCHASING;
    await request.save();
    this.emitPurchaseRequestChanged(request, 'updated');
  }

  private async reconcileCommissionStatus(
    request: PurchaseRequestDocument,
  ): Promise<void> {
    if (request.bossDecision === ApprovalDecision.APPROVED) {
      await this.reconcileBossApprovedStatus(request);
      return;
    }

    if (request.bossDecision === ApprovalDecision.REJECTED) {
      return;
    }

    const lockedStatuses: PurchaseRequestStatus[] = [
      PurchaseRequestStatus.REJECTED,
      PurchaseRequestStatus.PURCHASING,
      PurchaseRequestStatus.PURCHASED,
      PurchaseRequestStatus.WAREHOUSE_IN_TRANSIT,
      PurchaseRequestStatus.WAREHOUSE_COMPLETED,
    ];

    if (lockedStatuses.includes(request.status)) {
      return;
    }

    this.syncMemberDecisionsWithCommission(request);
    const next = this.recomputeStatus(request);

    if (next === request.status) {
      return;
    }

    request.status = next;
    await request.save();
    this.emitPurchaseRequestChanged(request, 'updated');
  }

  private buildSubmittedHistoryStep(
    applicant: UserSnapshotEmbeddable,
    comment?: string,
    purchaseDeadline?: Date,
    purchaseDeadlineMandatory?: boolean,
  ): HistoryStepEmbeddable {
    return {
      type: HistoryStepType.SUBMITTED,
      actorUserId: applicant.userId,
      actorDisplayName: applicant.displayName,
      actorLogin: applicant.login,
      comment: comment?.trim() ?? '',
      purchaseDeadline,
      purchaseDeadlineMandatory,
      createdAt: new Date(),
    };
  }

  private normalizeRequestItems(
    items: Array<{
      name: string;
      characteristics: string;
      quantity: number;
      unit: string;
      manufacturingCountry: string;
    }>,
  ) {
    return items.map((item) => ({
      name: item.name.trim(),
      characteristics: item.characteristics.trim(),
      quantity: item.quantity,
      unit: item.unit.trim(),
      manufacturingCountry: item.manufacturingCountry.trim(),
    }));
  }

  private resolveSessionTitle(
    session: PurchaseRequestSessionDocument,
    fallbackIndex = 1,
  ) {
    if (session.title?.trim()) {
      return session.title.trim();
    }

    const firstNamedItem = (session.items ?? []).find((item) => item.name?.trim());
    if (firstNamedItem?.name?.trim()) {
      return firstNamedItem.name.trim();
    }

    if (session.comment?.trim()) {
      const snippet = session.comment.trim();
      return snippet.length > 48 ? `${snippet.slice(0, 48)}…` : snippet;
    }

    return `Ariza ${fallbackIndex}`;
  }

  private toSessionPublic(
    session: PurchaseRequestSessionDocument,
    fallbackIndex = 1,
  ) {
    const firstNamedItem = (session.items ?? []).find((item) => item.name?.trim());

    return {
      id: session.id,
      title: this.resolveSessionTitle(session, fallbackIndex),
      preview: firstNamedItem?.name?.trim() || session.comment?.trim() || '',
      commissionMemberIds: session.commissionMemberIds.map(String),
      bossId: session.bossId ? String(session.bossId) : '',
      items: (session.items ?? []).map((item) => ({
        name: item.name ?? '',
        characteristics: item.characteristics ?? '',
        quantity: item.quantity ?? 1,
        unit: item.unit ?? '',
        manufacturingCountry: item.manufacturingCountry ?? '',
      })),
      comment: session.comment ?? '',
      commissionAgreementText: session.commissionAgreementText ?? '',
      purchasePeriodType: session.purchasePeriodType ?? null,
      purchasePeriodYear: session.purchasePeriodYear ?? null,
      purchasePeriodQuarter: session.purchasePeriodQuarter ?? null,
      purchasePeriodMonth: session.purchasePeriodMonth ?? null,
      editingRequestId: session.editingRequestId
        ? String(session.editingRequestId)
        : null,
      reservedRequestCode: session.reservedRequestCode ?? null,
      createdAt: session.createdAt ?? null,
      updatedAt: session.updatedAt ?? null,
    };
  }

  private async findActiveSessionOrFail(userId: string, sessionId: string) {
    const session = await this.purchaseRequestSessionModel
      .findOne({
        _id: new Types.ObjectId(sessionId),
        userId: new Types.ObjectId(userId),
      })
      .exec();

    if (!session) {
      throw new NotFoundException('Faol seans topilmadi');
    }

    return session;
  }

  private sessionHasContent(session: PurchaseRequestSessionDocument): boolean {
    if (session.comment?.trim()) return true;
    if (session.commissionAgreementText?.trim()) return true;
    if (session.commissionMemberIds?.length) return true;
    if (session.bossId) return true;
    if (session.purchasePeriodType) return true;

    return (session.items ?? []).some(
      (item) =>
        item.name?.trim() ||
        item.characteristics?.trim() ||
        item.unit?.trim() ||
        item.manufacturingCountry?.trim() ||
        (item.quantity && item.quantity !== 1),
    );
  }

  private parsePurchaseDeadline(value?: string): Date | undefined {
    if (!value?.trim()) {
      return undefined;
    }

    const parsed = new Date(value);

    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('Sotib olish muddati noto‘g‘ri formatda');
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    parsed.setHours(0, 0, 0, 0);

    if (parsed < today) {
      throw new BadRequestException(
        'Sotib olish muddati bugungi kundan oldin bo‘lishi mumkin emas',
      );
    }

    return parsed;
  }

  private ensureLegacyFields(request: PurchaseRequestDocument) {
    if (!request.status) {
      request.status = PurchaseRequestStatus.COMMISSION_REVIEW;
    }

    if (!request.memberDecisions?.length) {
      request.memberDecisions = this.buildMemberDecisions(
        request.commissionMembers ?? [],
      );
    } else {
      this.syncMemberDecisionsWithCommission(request);
    }

    if (!request.history?.length) {
      request.history = [
        this.buildSubmittedHistoryStep(request.applicant, request.comment),
      ];
    }
  }

  private recomputeStatus(
    request: PurchaseRequestDocument,
  ): PurchaseRequestStatus {
    if (request.bossDecision === ApprovalDecision.APPROVED) {
      if (request.status === PurchaseRequestStatus.PURCHASED) {
        return PurchaseRequestStatus.PURCHASED;
      }

      if (request.status === PurchaseRequestStatus.WAREHOUSE_IN_TRANSIT) {
        return PurchaseRequestStatus.WAREHOUSE_IN_TRANSIT;
      }

      if (request.status === PurchaseRequestStatus.WAREHOUSE_COMPLETED) {
        return PurchaseRequestStatus.WAREHOUSE_COMPLETED;
      }

      return PurchaseRequestStatus.PURCHASING;
    }

    if (
      request.bossDecision === ApprovalDecision.REJECTED &&
      request.status === PurchaseRequestStatus.REJECTED
    ) {
      return PurchaseRequestStatus.REJECTED;
    }

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

    if (!this.areAllCommissionMembersAgreed(request)) {
      return PurchaseRequestStatus.COMMISSION_REVIEW;
    }

    return PurchaseRequestStatus.BOSS_DECISION_PENDING;
  }

  private hasAnyMemberAgreed(request: PurchaseRequestDocument) {
    return (request.memberDecisions ?? []).some((vote) =>
      this.isMemberAgreed(vote.decision),
    );
  }

  private hasRejectedMemberDecisions(request: PurchaseRequestDocument) {
    return (request.memberDecisions ?? []).some(
      (vote) => vote.decision === ApprovalDecision.REJECTED,
    );
  }

  /** Boshliq rad etgan, komissiya to‘liq kelishgan — faqat boshliqqa qayta yuborish */
  private isBossRejectionPendingResubmit(request: PurchaseRequestDocument) {
    return (
      request.status === PurchaseRequestStatus.REJECTED &&
      request.bossDecision === ApprovalDecision.REJECTED &&
      this.areAllCommissionMembersAgreed(request)
    );
  }

  private isCommissionResubmitPhase(request: PurchaseRequestDocument) {
    return (
      request.status === PurchaseRequestStatus.COMMISSION_REVIEW ||
      request.status === PurchaseRequestStatus.PARTIAL_REVISION
    );
  }

  /** Boshliq tasdiqlamaguncha ariza beruvchi tahrirlashi mumkin */
  private isEditableBeforeBossApproval(request: PurchaseRequestDocument) {
    if (request.bossDecision === ApprovalDecision.APPROVED) {
      return false;
    }

    const workflowStatus = this.getWorkflowStatus(request);

    const postBossApprovalStatuses: PurchaseRequestStatus[] = [
      PurchaseRequestStatus.PURCHASING,
      PurchaseRequestStatus.PURCHASED,
      PurchaseRequestStatus.WAREHOUSE_IN_TRANSIT,
      PurchaseRequestStatus.WAREHOUSE_COMPLETED,
    ];

    if (
      postBossApprovalStatuses.includes(request.status) ||
      postBossApprovalStatuses.includes(workflowStatus)
    ) {
      return false;
    }

    const isRejectedState =
      request.status === PurchaseRequestStatus.REJECTED ||
      workflowStatus === PurchaseRequestStatus.REJECTED;

    if (isRejectedState) {
      return request.bossDecision === ApprovalDecision.REJECTED;
    }

    return true;
  }

  private canOpenDocumentEditSession(request: PurchaseRequestDocument) {
    return this.isEditableBeforeBossApproval(request);
  }

  private async applyResubmitFieldsToRequest(
    request: PurchaseRequestDocument,
    dto: ResubmitPurchaseRequestDto,
  ) {
    const commissionMemberIds =
      dto.commissionMemberIds?.length
        ? dto.commissionMemberIds
        : (request.commissionMembers ?? []).map((member) => String(member.userId));

    const bossId = dto.bossId?.trim()
      ? dto.bossId
      : request.boss?.userId
        ? String(request.boss.userId)
        : '';

    if (!commissionMemberIds.length) {
      throw new BadRequestException('Kamida bitta komissiya a’zosini tanlang');
    }

    if (!bossId) {
      throw new BadRequestException('Boshliqni tanlang');
    }

    if (commissionMemberIds.includes(bossId)) {
      throw new BadRequestException(
        'Boshliq komissiya a’zolari ro‘yxatida bo‘lmasligi kerak',
      );
    }

    validatePurchasePeriod(dto);
    const purchasePeriod = normalizePurchasePeriodFields(dto);

    request.commissionMembers = await this.buildUserSnapshots(
      commissionMemberIds,
    );
    const [boss] = await this.buildUserSnapshots([bossId]);
    request.boss = boss;
    request.items = this.normalizeRequestItems(dto.items);
    request.comment = dto.comment?.trim() ?? '';
    if (dto.commissionAgreementText !== undefined) {
      request.commissionAgreementText = dto.commissionAgreementText?.trim() ?? '';
    }
    request.purchasePeriodType = purchasePeriod.purchasePeriodType;
    request.purchasePeriodYear = purchasePeriod.purchasePeriodYear;
    request.purchasePeriodQuarter = purchasePeriod.purchasePeriodQuarter;
    request.purchasePeriodMonth = purchasePeriod.purchasePeriodMonth;
    request.markModified('items');
  }

  private async regenerateKelishuvAfterResubmitIfNeeded(
    request: PurchaseRequestDocument,
    options?: { skipWhenDocumentsProvided?: boolean },
  ) {
    if (options?.skipWhenDocumentsProvided || !request.submittedKelishuv) {
      return;
    }

    try {
      request.submittedKelishuv =
        await this.sessionDocumentsService.regenerateRequestKelishuvDocument(
          request,
        );
      await request.save();
    } catch (error) {
      this.logger.warn(
        `Ariza ${request.id} kelishuv hujjatini yangilab bo‘lmadi`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /** Umumiy holatda atkaz alohida ko‘rsatilmaydi — kelishuv jarayonida qoladi. */
  private getEffectivePublicStatus(
    request: PurchaseRequestDocument,
  ): PurchaseRequestStatus {
    if (
      request.status === PurchaseRequestStatus.PARTIAL_REVISION &&
      this.isCommissionResubmitPhase(request)
    ) {
      return PurchaseRequestStatus.COMMISSION_REVIEW;
    }

    return request.status;
  }

  private isBossDecisionPhase(request: PurchaseRequestDocument) {
    if (request.bossDecision) {
      return false;
    }

    const lockedStatuses: PurchaseRequestStatus[] = [
      PurchaseRequestStatus.REJECTED,
      PurchaseRequestStatus.PURCHASING,
      PurchaseRequestStatus.PURCHASED,
      PurchaseRequestStatus.WAREHOUSE_IN_TRANSIT,
      PurchaseRequestStatus.WAREHOUSE_COMPLETED,
    ];

    if (lockedStatuses.includes(request.status)) {
      return false;
    }

    return this.areAllCommissionMembersAgreed(request);
  }

  private isCommissionReviewOpen(request: PurchaseRequestDocument) {
    if (!this.isCommissionResubmitPhase(request)) {
      return false;
    }

    return (request.memberDecisions ?? []).some((vote) => !vote.decision);
  }

  private isCommissionMember(
    request: PurchaseRequestDocument,
    userId: string,
    userLogin?: string,
  ) {
    const normalized = this.normalizeUserId(userId);
    const normalizedLogin = userLogin?.trim().toLowerCase();

    if (
      request.commissionMembers.some(
        (member) => this.normalizeUserId(member.userId) === normalized,
      )
    ) {
      return true;
    }

    if (!normalizedLogin) {
      return false;
    }

    return request.commissionMembers.some(
      (member) => member.login?.trim().toLowerCase() === normalizedLogin,
    );
  }

  private resolveApprovalParticipantUserIds(
    request: PurchaseRequestDocument,
  ): string[] {
    const ids = new Set<string>();
    const add = (value: unknown) => {
      const normalized = this.normalizeUserId(value);

      if (normalized) {
        ids.add(normalized);
      }
    };

    add(request.boss?.userId);

    for (const member of request.commissionMembers ?? []) {
      add(member.userId);
    }

    for (const vote of request.memberDecisions ?? []) {
      add(vote.userId);
    }

    for (const step of request.history ?? []) {
      if (
        step.type === HistoryStepType.DECISION ||
        step.type === HistoryStepType.BOSS_DECISION ||
        step.type === HistoryStepType.BOSS_CONFIRMED
      ) {
        add(step.actorUserId);
      }
    }

    for (const stored of request.approvalParticipantUserIds ?? []) {
      add(stored);
    }

    return [...ids];
  }

  private resolveApprovalParticipantLogins(
    request: PurchaseRequestDocument,
  ): Set<string> {
    const logins = new Set<string>();
    const add = (value?: string | null) => {
      const normalized = value?.trim().toLowerCase();

      if (normalized) {
        logins.add(normalized);
      }
    };

    add(request.boss?.login);

    for (const member of request.commissionMembers ?? []) {
      add(member.login);
    }

    for (const vote of request.memberDecisions ?? []) {
      add(vote.login);
    }

    for (const step of request.history ?? []) {
      if (
        step.type === HistoryStepType.DECISION ||
        step.type === HistoryStepType.BOSS_DECISION ||
        step.type === HistoryStepType.BOSS_CONFIRMED
      ) {
        add(step.actorLogin);
      }
    }

    return logins;
  }

  private syncApprovalParticipantUserIds(
    request: PurchaseRequestDocument,
  ): void {
    request.approvalParticipantUserIds =
      this.resolveApprovalParticipantUserIds(request).map(
        (id) => new Types.ObjectId(id),
      );
    request.markModified('approvalParticipantUserIds');
  }

  private viewerMatchesApprovalParticipants(
    request: PurchaseRequestDocument,
    userId: string,
    userLogin?: string,
  ): boolean {
    const viewerId = this.normalizeUserId(userId);

    if (
      viewerId &&
      this.resolveApprovalParticipantUserIds(request).includes(viewerId)
    ) {
      return true;
    }

    const viewerLogin = userLogin?.trim().toLowerCase();

    if (!viewerLogin) {
      return false;
    }

    return this.resolveApprovalParticipantLogins(request).has(viewerLogin);
  }

  private hasApprovalInboxParticipation(
    request: PurchaseRequestDocument,
    userId: string,
    userLogin?: string,
  ) {
    return this.viewerMatchesApprovalParticipants(
      request,
      userId,
      userLogin,
    );
  }

  private isBoss(request: PurchaseRequestDocument, userId: string, userLogin?: string) {
    if (
      this.normalizeUserId(request.boss.userId) ===
      this.normalizeUserId(userId)
    ) {
      return true;
    }

    const bossLogin = request.boss.login?.trim().toLowerCase();
    const viewerLogin = userLogin?.trim().toLowerCase();

    return Boolean(bossLogin && viewerLogin && bossLogin === viewerLogin);
  }

  private canAccessRequest(
    request: PurchaseRequestDocument,
    userId: string,
    role?: UserRole,
    userLogin?: string,
  ) {
    if (isSuperAdminRole(role)) {
      return true;
    }

    return (
      String(request.createdById) === userId ||
      this.isCommissionMember(request, userId) ||
      this.isBoss(request, userId, userLogin)
    );
  }

  private assertCanAccess(
    request: PurchaseRequestDocument,
    userId: string,
    role?: UserRole,
    userLogin?: string,
  ) {
    if (!this.canAccessRequest(request, userId, role, userLogin)) {
      throw new ForbiddenException('Ushbu arizaga kirish huquqi yo‘q');
    }
  }

  private isApplicant(request: PurchaseRequestDocument, userId: string) {
    const normalized = this.normalizeUserId(userId);

    return (
      this.normalizeUserId(request.createdById) === normalized ||
      this.normalizeUserId(request.applicant?.userId) === normalized
    );
  }

  private canEditPurchaseRequestAsUser(
    request: PurchaseRequestDocument,
    userId: string,
    role?: UserRole,
  ) {
    if (isSuperAdminRole(role)) {
      return true;
    }

    return this.isApplicant(request, userId);
  }

  private getViewerRole(
    request: PurchaseRequestDocument,
    userId: string,
    userLogin?: string,
  ) {
    if (this.isBoss(request, userId, userLogin)) return 'boss' as const;
    if (this.isApplicant(request, userId)) return 'applicant' as const;
    if (this.isCommissionMember(request, userId, userLogin)) {
      return 'commission' as const;
    }

    if (this.hasApprovalHistoryParticipation(request, userId, userLogin)) {
      const bossHistoryTypes = new Set<HistoryStepType>([
        HistoryStepType.BOSS_DECISION,
        HistoryStepType.BOSS_CONFIRMED,
      ]);

      if (
        (request.history ?? []).some(
          (step) =>
            bossHistoryTypes.has(step.type) &&
            (this.normalizeUserId(step.actorUserId) ===
              this.normalizeUserId(userId) ||
              (userLogin?.trim() &&
                step.actorLogin?.trim().toLowerCase() ===
                  userLogin.trim().toLowerCase())),
        )
      ) {
        return 'boss' as const;
      }
    }

    if (this.hasMemberDecisionParticipation(request, userId, userLogin)) {
      return 'commission' as const;
    }

    return null;
  }

  private hasMemberDecisionParticipation(
    request: PurchaseRequestDocument,
    userId: string,
    userLogin?: string,
  ) {
    const normalized = this.normalizeUserId(userId);
    const normalizedLogin = userLogin?.trim().toLowerCase();

    return (request.memberDecisions ?? []).some((vote) => {
      if (this.normalizeUserId(vote.userId) === normalized) {
        return true;
      }

      if (!normalizedLogin) {
        return false;
      }

      return vote.login?.trim().toLowerCase() === normalizedLogin;
    });
  }

  private hasApprovalHistoryParticipation(
    request: PurchaseRequestDocument,
    userId: string,
    userLogin?: string,
  ) {
    const normalized = this.normalizeUserId(userId);
    const normalizedLogin = userLogin?.trim().toLowerCase();
    const participationTypes = new Set<HistoryStepType>([
      HistoryStepType.DECISION,
      HistoryStepType.BOSS_DECISION,
      HistoryStepType.BOSS_CONFIRMED,
    ]);

    return (request.history ?? []).some((step) => {
      if (!participationTypes.has(step.type)) {
        return false;
      }

      if (this.normalizeUserId(step.actorUserId) === normalized) {
        return true;
      }

      if (!normalizedLogin) {
        return false;
      }

      return step.actorLogin?.trim().toLowerCase() === normalizedLogin;
    });
  }

  private canDeleteRequest(
    request: PurchaseRequestDocument,
    userId: string,
    role?: UserRole,
  ): boolean {
    if (request.status !== PurchaseRequestStatus.COMMISSION_REVIEW) {
      return false;
    }

    if (isSuperAdminRole(role)) {
      return true;
    }

    if (!this.isApplicant(request, userId)) {
      return false;
    }

    const createdAt = request.createdAt?.getTime();

    if (!createdAt) {
      return false;
    }

    return Date.now() - createdAt < PURCHASE_REQUEST_DELETE_WINDOW_MS;
  }

  private toPublic(
    request: PurchaseRequestDocument,
    viewerUserId?: string,
    warehouseMeta?: {
      dispatches?: Array<{
        id: string;
        dispatchCode: string;
        status: string;
        purchaseBatchId?: string;
        targetStructure: { shortName: string };
      }>;
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
    viewerAuthRole?: UserRole,
    options?: {
      approvalSubmitAllowed?: boolean;
      deleteAllowed?: boolean;
      updateAllowed?: boolean;
      createAllowed?: boolean;
      isViewerElevatedAdmin?: boolean;
      viewerLogin?: string;
      approvalInboxView?: boolean;
    },
  ) {
    this.ensureLegacyFields(request);

    const viewerRole = viewerUserId
      ? this.getViewerRole(request, viewerUserId, options?.viewerLogin)
      : null;

    const canDelete =
      viewerUserId &&
      (options?.deleteAllowed ?? true) &&
      this.canDeleteRequest(request, viewerUserId, viewerAuthRole);

    const myDecision = viewerUserId
      ? request.memberDecisions?.find((decision) => {
          if (
            this.normalizeUserId(decision.userId) ===
            this.normalizeUserId(viewerUserId)
          ) {
            return true;
          }

          const viewerLogin = options?.viewerLogin?.trim().toLowerCase();

          return Boolean(
            viewerLogin &&
              decision.login?.trim().toLowerCase() === viewerLogin,
          );
        })
      : undefined;

    const workflowStatus = this.getWorkflowStatus(request);
    const isBossViewer = Boolean(
      viewerUserId &&
        this.isBoss(request, viewerUserId, options?.viewerLogin),
    );

    const canSubmitDecision =
      !this.isApprovalWorkflowClosed(request) &&
      (options?.approvalSubmitAllowed ?? true) &&
      viewerRole === 'commission' &&
      workflowStatus === PurchaseRequestStatus.COMMISSION_REVIEW &&
      this.isCommissionReviewOpen(request) &&
      !myDecision?.decision &&
      !this.isMemberFullyApproved(myDecision?.decision);

    const canConfirmBossDecision =
      !this.isApprovalWorkflowClosed(request) &&
      isBossViewer &&
      this.isBossDecisionPhase(request);

    const isApplicantViewer = Boolean(
      viewerUserId && this.isApplicant(request, viewerUserId),
    );

    const canMutateOwnRequests = Boolean(
      options?.updateAllowed || options?.createAllowed,
    );

    const isViewerAdmin =
      isSuperAdminRole(viewerAuthRole) ||
      Boolean(options?.isViewerElevatedAdmin);

    const canEditInReview = isViewerAdmin
      ? true
      : canMutateOwnRequests &&
        isApplicantViewer &&
        this.isEditableBeforeBossApproval(request);

    const canResubmitToBoss = false;

    const canResubmit = false;

    const publicStatus = this.getPublicStatus(request);
    const defaultStatusLabel = this.shouldExposeBossDecision(request) &&
      request.bossDecision === ApprovalDecision.APPROVED
      ? 'Tasdiqlangan'
      : (PURCHASE_REQUEST_STATUS_LABELS[publicStatus] ?? 'Nomaʼlum holat');
    const statusLabel =
      options?.approvalInboxView
        ? defaultStatusLabel
        : viewerRole === 'commission' &&
            this.isMemberFullyApproved(myDecision?.decision) &&
            !canSubmitDecision
          ? APPROVAL_DECISION_LABELS[ApprovalDecision.APPROVED]
          : defaultStatusLabel;

    return {
      id: request.id,
      requestCode: request.requestCode,
      status: publicStatus,
      workflowStatus,
      statusLabel,
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
        structureLeaderName: request.boss.structureLeaderName?.trim() || '',
      },
      items: request.items.map((item) => ({
        name: item.name,
        characteristics: item.characteristics,
        quantity: item.quantity,
        unit: item.unit ?? '',
        manufacturingCountry: item.manufacturingCountry ?? '',
        purchaseAmount: item.purchaseAmount ?? null,
        purchaseVatRate: item.purchaseVatRate ?? 0,
        purchaseVatAmount: item.purchaseVatAmount ?? 0,
        isPurchased: Boolean(item.isPurchased),
        purchasedAt: item.purchasedAt ?? null,
        purchaseBatchId: item.purchaseBatchId ?? null,
        isPurchaseUnavailable: Boolean(item.isPurchaseUnavailable),
        purchaseUnavailableReason: item.purchaseUnavailableReason ?? null,
        purchaseUnavailableAt: item.purchaseUnavailableAt ?? null,
        purchaseUnavailableBatchId: item.purchaseUnavailableBatchId ?? null,
        originalRequestedItem: item.originalRequestedItem
          ? {
              name: item.originalRequestedItem.name,
              characteristics: item.originalRequestedItem.characteristics,
              quantity: item.originalRequestedItem.quantity,
              unit: item.originalRequestedItem.unit ?? '',
            }
          : null,
      })),
      comment: request.comment,
      commissionAgreementText: request.commissionAgreementText ?? '',
      purchaseDeadline: request.purchaseDeadline ?? null,
      purchaseDeadlineMandatory: request.purchaseDeadline
        ? Boolean(request.purchaseDeadlineMandatory)
        : null,
      purchasePeriodType: request.purchasePeriodType ?? null,
      purchasePeriodYear: request.purchasePeriodYear ?? null,
      purchasePeriodQuarter: request.purchasePeriodQuarter ?? null,
      purchasePeriodMonth: request.purchasePeriodMonth ?? null,
      purchasePeriodLabel: formatPurchasePeriodLabel(request),
      createdById: String(request.createdById),
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
            leaderName: request.applicantStructure.leaderName?.trim() || '',
            capturedAt: request.applicantStructure.capturedAt,
          }
        : null,
      memberDecisions: (request.memberDecisions ?? []).map((decision) => ({
        userId: String(decision.userId),
        displayName: decision.displayName,
        login: decision.login,
        structureShortName: decision.structureShortName ?? null,
        position: decision.position?.trim() || '',
        decision: decision.decision ?? null,
        decisionLabel: decision.decision
          ? APPROVAL_DECISION_LABELS[decision.decision]
          : MEMBER_DECISION_PENDING_LABEL,
        comment: decision.comment,
        decidedAt: decision.decidedAt ?? null,
      })),
      rejectedMemberIds: (request.memberDecisions ?? [])
        .filter((decision) => decision.decision === ApprovalDecision.REJECTED)
        .map((decision) => String(decision.userId)),
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
        rejectionReasonKey: step.rejectionReasonKey ?? null,
        rejectionReasonLabel: step.rejectionReasonKey
          ? (PURCHASE_REJECTION_REASON_LABELS[
              step.rejectionReasonKey as keyof typeof PURCHASE_REJECTION_REASON_LABELS
            ] ?? null)
          : null,
        purchaseDeadline: step.purchaseDeadline ?? null,
        purchaseDeadlineMandatory:
          step.purchaseDeadline != null
            ? Boolean(step.purchaseDeadlineMandatory)
            : null,
        purchasedItemIndexes: step.purchasedItemIndexes ?? [],
        unavailableItemIndexes: step.unavailableItemIndexes ?? [],
        itemSubstitutions: (step.itemSubstitutions ?? []).map((row) => ({
          itemIndex: row.itemIndex,
          originalName: row.originalName,
          originalCharacteristics: row.originalCharacteristics,
          originalQuantity: row.originalQuantity,
          originalUnit: row.originalUnit ?? '',
          deliveredName: row.deliveredName,
          deliveredCharacteristics: row.deliveredCharacteristics,
          deliveredQuantity: row.deliveredQuantity,
          deliveredUnit: row.deliveredUnit ?? '',
          amount: row.amount,
        })),
        purchaseBatchId: step.purchaseBatchId ?? '',
        contractNumber: step.contractNumber ?? '',
        organizationName: step.organizationName ?? '',
        innOrPinfl: step.innOrPinfl ?? '',
        innOrPinflType: step.innOrPinflType ?? '',
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
      canEditInReview,
      canResubmit,
      canResubmitToBoss,
      canDelete,
      pendingPurchaseItemCount: this.countPendingPurchaseItems(request),
      pendingPurchaseQuantity: request.items
        .filter((item) => this.isItemPending(item))
        .reduce((sum, item) => sum + item.quantity, 0),
      canCompletePurchase: this.canPurchasePendingItems(request),
      canRejectPurchase:
        request.status === PurchaseRequestStatus.PURCHASING &&
        !request.items.some((item) => item.isPurchased || item.isPurchaseUnavailable),
      purchase: request.purchase
        ? this.mapPurchasePublic(request.purchase)
        : null,
      purchaseBatches: this.enrichPurchaseBatchesPublic(
        request,
        warehouseMeta?.dispatches ?? [],
      ),
      purchaseUnavailableBatches: this.mapPurchaseUnavailableBatchesPublic(
        request,
      ),
      // purchase.itemAmounts historically stores per-unit price; total = unitPrice * quantity
      purchaseTotalAmount: request.items.some((item) => item.isPurchased)
        ? request.items.reduce((sum, item) => {
            if (!item.isPurchased) {
              return sum;
            }

            const unit = item.purchaseAmount ?? 0;
            const vat = item.purchaseVatAmount ?? 0;
            return sum + (unit + vat) * item.quantity;
          }, 0)
        : null,
      canDispatchToWarehouse: warehouseMeta?.canDispatchToWarehouse ?? false,
      warehouseDispatch: warehouseMeta?.warehouseDispatch ?? null,
      warehouseReceipt: warehouseMeta?.warehouseReceipt ?? null,
      submittedBildirgi: request.submittedBildirgi
        ? {
            label: request.submittedBildirgi.label,
            originalName: request.submittedBildirgi.originalName,
            mimeType: request.submittedBildirgi.mimeType,
            size: request.submittedBildirgi.size,
          }
        : null,
      submittedKelishuv: request.submittedKelishuv
        ? {
            label: request.submittedKelishuv.label,
            originalName: request.submittedKelishuv.originalName,
            mimeType: request.submittedKelishuv.mimeType,
            size: request.submittedKelishuv.size,
          }
        : null,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    };
  }

  private mapDispatchStatusLabel(status: string) {
    if (status === 'PENDING_RECEIPT') {
      return 'Qabul kutilmoqda';
    }

    if (status === 'PARTIALLY_RECEIVED') {
      return 'Qisman qabul qilindi';
    }

    return 'Qabul qilindi';
  }

  private resolveDispatchForBatch(
    batchId: string,
    dispatches: Array<{
      id: string;
      dispatchCode: string;
      status: string;
      purchaseBatchId?: string;
      targetStructure: { shortName: string };
    }>,
  ) {
    return (
      dispatches.find((dispatch) => dispatch.purchaseBatchId === batchId) ??
      (batchId === 'legacy'
        ? dispatches.find((dispatch) => !dispatch.purchaseBatchId)
        : undefined) ??
      null
    );
  }

  private enrichPurchaseBatchesPublic(
    request: PurchaseRequestDocument,
    dispatches: Array<{
      id: string;
      dispatchCode: string;
      status: string;
      purchaseBatchId?: string;
      targetStructure: { shortName: string };
    }> = [],
  ) {
    return this.mapPurchaseBatchesPublic(request).map((batch) => {
      const dispatch = this.resolveDispatchForBatch(batch.batchId, dispatches);
      const hasPurchasedItems = batch.itemAmounts.length > 0;
      const canDispatchToWarehouse =
        hasPurchasedItems &&
        !dispatch &&
        [
          PurchaseRequestStatus.PURCHASING,
          PurchaseRequestStatus.PURCHASED,
          PurchaseRequestStatus.WAREHOUSE_IN_TRANSIT,
        ].includes(request.status);

      return {
        ...batch,
        canDispatchToWarehouse,
        warehouseDispatch: dispatch
          ? {
              id: dispatch.id,
              dispatchCode: dispatch.dispatchCode,
              status: dispatch.status,
              statusLabel: this.mapDispatchStatusLabel(dispatch.status),
              targetStructureShortName: dispatch.targetStructure.shortName,
            }
          : null,
      };
    });
  }

  buildWarehouseMetaFromDispatch(
    request: PurchaseRequestDocument,
    dispatches: Array<{
      id: string;
      dispatchCode: string;
      status: string;
      purchaseBatchId?: string;
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
    }> = [],
  ) {
    const enrichedBatches = this.enrichPurchaseBatchesPublic(
      request,
      dispatches,
    );
    const latest = dispatches[0] ?? null;

    return {
      dispatches,
      canDispatchToWarehouse: enrichedBatches.some(
        (batch) => batch.canDispatchToWarehouse,
      ),
      warehouseDispatch: latest
        ? {
            id: latest.id,
            dispatchCode: latest.dispatchCode,
            status: latest.status,
            statusLabel: this.mapDispatchStatusLabel(latest.status),
            targetStructureShortName: latest.targetStructure.shortName,
          }
        : null,
      warehouseReceipt: latest?.receipt ?? null,
    };
  }

  private mapPurchasePublic(purchase: PurchaseDetailsEmbeddable) {
    return {
      vendorName: purchase.vendorName,
      contractNumber: purchase.contractNumber ?? '',
      organizationName: purchase.organizationName ?? '',
      innOrPinfl: purchase.innOrPinfl ?? '',
      innOrPinflType: purchase.innOrPinflType ?? '',
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
        vatRate: row.vatRate ?? 0,
        vatAmount: row.vatAmount ?? 0,
      })),
      purchasedBy: {
        userId: String(purchase.purchasedById),
        displayName: purchase.purchasedByDisplayName,
        login: purchase.purchasedByLogin,
      },
      purchasedAt: purchase.purchasedAt,
    };
  }

  private resolveContractInfoFromHistory(
    request: PurchaseRequestDocument,
    batchId?: string,
  ):
    | Pick<
        PurchaseDetailsEmbeddable,
        'contractNumber' | 'organizationName' | 'innOrPinfl' | 'innOrPinflType'
      >
    | undefined {
    const steps = [...(request.history ?? [])]
      .filter(
        (step) =>
          (step.type === HistoryStepType.PURCHASED ||
            step.type === HistoryStepType.PARTIAL_PURCHASE) &&
          (!batchId || step.purchaseBatchId === batchId),
      )
      .sort(
        (left, right) =>
          new Date(right.createdAt).getTime() -
          new Date(left.createdAt).getTime(),
      );

    for (const step of steps) {
      if (
        step.contractNumber?.trim() ||
        step.organizationName?.trim() ||
        step.innOrPinfl?.trim()
      ) {
        return {
          contractNumber: step.contractNumber ?? '',
          organizationName: step.organizationName ?? '',
          innOrPinfl: step.innOrPinfl ?? '',
          innOrPinflType: step.innOrPinflType ?? '',
        };
      }
    }

    return undefined;
  }

  private mapPurchaseBatchPublic(
    batch: PurchaseBatchEmbeddable,
    contractFallback?: Pick<
      PurchaseDetailsEmbeddable,
      'contractNumber' | 'organizationName' | 'innOrPinfl' | 'innOrPinflType'
    >,
    historyFallback?: Pick<
      PurchaseDetailsEmbeddable,
      'contractNumber' | 'organizationName' | 'innOrPinfl' | 'innOrPinflType'
    >,
  ) {
    const contractNumber =
      batch.contractNumber?.trim() ||
      historyFallback?.contractNumber?.trim() ||
      contractFallback?.contractNumber?.trim() ||
      '';
    const organizationName =
      batch.organizationName?.trim() ||
      historyFallback?.organizationName?.trim() ||
      contractFallback?.organizationName?.trim() ||
      '';
    const innOrPinfl =
      batch.innOrPinfl?.trim() ||
      historyFallback?.innOrPinfl?.trim() ||
      contractFallback?.innOrPinfl?.trim() ||
      '';
    const innOrPinflType =
      batch.innOrPinflType?.trim() ||
      historyFallback?.innOrPinflType?.trim() ||
      contractFallback?.innOrPinflType?.trim() ||
      '';

    return {
      batchId: batch.batchId,
      contractNumber,
      organizationName,
      innOrPinfl,
      innOrPinflType,
      comment: batch.comment,
      links: batch.links.map((link) => ({
        label: link.label || '',
        url: link.url,
      })),
      files: batch.files.map((file) => ({
        label: file.label,
        storedName: file.storedName,
        originalName: file.originalName,
        mimeType: file.mimeType,
        size: file.size,
      })),
      itemAmounts: batch.itemAmounts.map((row) => ({
        itemIndex: row.itemIndex,
        amount: row.amount,
        vatRate: row.vatRate ?? 0,
        vatAmount: row.vatAmount ?? 0,
      })),
      itemSubstitutions: (batch.itemSubstitutions ?? []).map((row) => ({
        itemIndex: row.itemIndex,
        originalName: row.originalName,
        originalCharacteristics: row.originalCharacteristics,
        originalQuantity: row.originalQuantity,
        originalUnit: row.originalUnit ?? '',
        deliveredName: row.deliveredName,
        deliveredCharacteristics: row.deliveredCharacteristics,
        deliveredQuantity: row.deliveredQuantity,
        deliveredUnit: row.deliveredUnit ?? '',
        amount: row.amount,
        vatRate: row.vatRate ?? 0,
        vatAmount: row.vatAmount ?? 0,
      })),
      purchasedBy: {
        userId: String(batch.purchasedById),
        displayName: batch.purchasedByDisplayName,
        login: batch.purchasedByLogin,
      },
      purchasedAt: batch.purchasedAt,
    };
  }

  private mapPurchaseBatchesPublic(request: PurchaseRequestDocument) {
    const batches = request.purchaseBatches ?? [];

    if (batches.length) {
      return [...batches]
        .sort(
          (left, right) =>
            new Date(right.purchasedAt).getTime() -
            new Date(left.purchasedAt).getTime(),
        )
        .map((batch) =>
          this.mapPurchaseBatchPublic(
            batch,
            request.purchase,
            this.resolveContractInfoFromHistory(request, batch.batchId),
          ),
        );
    }

    if (!request.purchase) {
      return [];
    }

    const purchasedItems = request.items
      .map((item, itemIndex) => ({ item, itemIndex }))
      .filter(({ item }) => item.isPurchased);

    if (!purchasedItems.length) {
      return [];
    }

    return [
      this.mapPurchaseBatchPublic({
        batchId: 'legacy',
        comment: request.purchase.comment ?? '',
        contractNumber: request.purchase.contractNumber ?? '',
        organizationName: request.purchase.organizationName ?? '',
        innOrPinfl: request.purchase.innOrPinfl ?? '',
        innOrPinflType: request.purchase.innOrPinflType ?? '',
        links: request.purchase.links ?? [],
        files: request.purchase.files ?? [],
        itemAmounts: purchasedItems.map(({ item, itemIndex }) => ({
          itemIndex,
          amount: item.purchaseAmount ?? 0,
          vatRate: item.purchaseVatRate ?? 0,
          vatAmount: item.purchaseVatAmount ?? 0,
        })),
        itemSubstitutions: purchasedItems
          .filter(({ item }) => item.originalRequestedItem)
          .map(({ item, itemIndex }) => ({
            itemIndex,
            originalName: item.originalRequestedItem!.name,
            originalCharacteristics: item.originalRequestedItem!.characteristics,
            originalQuantity: item.originalRequestedItem!.quantity,
            originalUnit: item.originalRequestedItem!.unit ?? '',
            deliveredName: item.name,
            deliveredCharacteristics: item.characteristics,
            deliveredQuantity: item.quantity,
            deliveredUnit: item.unit ?? '',
            amount: item.purchaseAmount ?? 0,
            vatRate: item.purchaseVatRate ?? 0,
            vatAmount: item.purchaseVatAmount ?? 0,
          })),
        purchasedById: request.purchase.purchasedById,
        purchasedByDisplayName: request.purchase.purchasedByDisplayName,
        purchasedByLogin: request.purchase.purchasedByLogin,
        purchasedAt: request.purchase.purchasedAt,
      }),
    ];
  }

  private isItemPending(item: {
    isPurchased?: boolean;
    isPurchaseUnavailable?: boolean;
  }) {
    return !item.isPurchased && !item.isPurchaseUnavailable;
  }

  private countPendingPurchaseItems(request: PurchaseRequestDocument) {
    return request.items.filter((item) => this.isItemPending(item)).length;
  }

  private buildPendingPurchaseItemElemMatch(): Record<string, unknown> {
    return {
      items: {
        $elemMatch: {
          isPurchased: { $ne: true },
          isPurchaseUnavailable: { $ne: true },
        },
      },
    };
  }

  private buildAwaitingWarehouseDispatchMatch(): Record<string, unknown> {
    return {
      status: PurchaseRequestStatus.PURCHASED,
      'items.isPurchased': true,
    };
  }

  private buildPurchasingInboxQueueMatch(): Record<string, unknown> {
    return {
      $or: [
        this.buildPendingPurchaseItemElemMatch(),
        this.buildAwaitingWarehouseDispatchMatch(),
      ],
    };
  }

  private canPurchasePendingItems(request: PurchaseRequestDocument) {
    return (
      this.countPendingPurchaseItems(request) > 0 &&
      this.purchasingInboxStatuses().includes(request.status)
    );
  }

  private areAllItemsResolved(request: PurchaseRequestDocument) {
    return request.items.every(
      (item) => item.isPurchased || item.isPurchaseUnavailable,
    );
  }

  private mapPurchaseUnavailableBatchPublic(
    batch: PurchaseUnavailableBatchEmbeddable,
  ) {
    return {
      batchId: batch.batchId,
      comment: batch.comment,
      itemIndexes: batch.itemIndexes,
      markedBy: {
        userId: String(batch.markedById),
        displayName: batch.markedByDisplayName,
        login: batch.markedByLogin,
      },
      markedAt: batch.markedAt,
    };
  }

  private mapPurchaseUnavailableBatchesPublic(request: PurchaseRequestDocument) {
    const batches = request.purchaseUnavailableBatches ?? [];

    if (batches.length) {
      return [...batches]
        .sort(
          (left, right) =>
            new Date(right.markedAt).getTime() -
            new Date(left.markedAt).getTime(),
        )
        .map((batch) => this.mapPurchaseUnavailableBatchPublic(batch));
    }

    const unavailableItems = request.items
      .map((item, itemIndex) => ({ item, itemIndex }))
      .filter(({ item }) => item.isPurchaseUnavailable);

    if (!unavailableItems.length) {
      return [];
    }

    const grouped = new Map<string, typeof unavailableItems>();

    for (const entry of unavailableItems) {
      const key = entry.item.purchaseUnavailableBatchId ?? 'legacy';
      const bucket = grouped.get(key) ?? [];
      bucket.push(entry);
      grouped.set(key, bucket);
    }

    return [...grouped.entries()].map(([batchId, entries]) => {
      const first = entries[0]?.item;
      return this.mapPurchaseUnavailableBatchPublic({
        batchId,
        comment: first?.purchaseUnavailableReason ?? '',
        itemIndexes: entries.map((entry) => entry.itemIndex),
        markedById: request.purchase?.purchasedById ?? request.createdById,
        markedByDisplayName:
          request.purchase?.purchasedByDisplayName ??
          request.applicant.displayName,
        markedByLogin:
          request.purchase?.purchasedByLogin ?? request.applicant.login,
        markedAt: first?.purchaseUnavailableAt ?? request.updatedAt ?? new Date(),
      });
    });
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
    const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

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
    const clauses: Record<string, unknown>[] = [];

    if (!isSuperAdminRole(role)) {
      clauses.push({ createdById: new Types.ObjectId(userId) });
    }

    if (query.status) {
      clauses.push({ status: query.status });
    }

    const term = query.search?.trim();

    if (term) {
      clauses.push({ $or: this.buildSearchOr(term) });
    }

    appendDateRangeClause(clauses, 'createdAt', query.dateFrom, query.dateTo);

    if (!clauses.length) {
      return {};
    }

    if (clauses.length === 1) {
      return clauses[0];
    }

    return { $and: clauses };
  }

  async findHistoryEventsPaginated(
    query: QueryPurchaseRequestHistoryDto,
    userId: string,
    role?: UserRole,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;

    const preMatchClauses: Record<string, unknown>[] = [
      { 'history.0': { $exists: true } },
    ];

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
          { 'applicantStructure.fullName': regex },
          { 'applicantStructure.shortName': regex },
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
      {
        $sort: {
          'applicantStructure.shortName': 1,
          'history.createdAt': -1,
        },
      },
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
                purchaseDeadline: '$history.purchaseDeadline',
                purchaseDeadlineMandatory: '$history.purchaseDeadlineMandatory',
                applicantDisplayName: '$applicant.displayName',
                applicantLogin: '$applicant.login',
                applicantStructureId: {
                  $toString: '$applicantStructure.structureId',
                },
                applicantStructureShortName: '$applicantStructure.shortName',
                applicantStructureFullName: '$applicantStructure.fullName',
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
          purchaseDeadline?: Date;
          purchaseDeadlineMandatory?: boolean;
          applicantDisplayName: string;
          applicantLogin: string;
          applicantStructureId?: string;
          applicantStructureShortName?: string;
          applicantStructureFullName?: string;
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
          purchaseDeadline: row.purchaseDeadline ?? null,
          purchaseDeadlineMandatory:
            row.purchaseDeadline != null
              ? Boolean(row.purchaseDeadlineMandatory)
              : null,
          actor: {
            displayName: row.actorDisplayName,
            login: row.actorLogin,
          },
          applicant: {
            displayName: row.applicantDisplayName,
            login: row.applicantLogin,
          },
          applicantStructure: row.applicantStructureId
            ? {
                structureId: row.applicantStructureId,
                shortName: row.applicantStructureShortName?.trim() || '—',
                fullName:
                  row.applicantStructureFullName?.trim() ||
                  row.applicantStructureShortName?.trim() ||
                  'Noma’lum tuzilma',
              }
            : null,
        }),
      ),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  private escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private buildApprovalInboxLoginFieldClause(
    field: string,
    viewerLogin?: string,
  ): Record<string, unknown> | null {
    const normalizedLogin = viewerLogin?.trim().toLowerCase();

    if (!normalizedLogin) {
      return null;
    }

    return {
      [field]: {
        $regex: new RegExp(`^${this.escapeRegex(normalizedLogin)}$`, 'i'),
      },
    };
  }

  private buildApprovalInboxUserIdValues(userId: string) {
    const values: Array<Types.ObjectId | string> = [
      new Types.ObjectId(userId),
    ];

    if (Types.ObjectId.isValid(userId)) {
      values.push(userId);
    }

    return values;
  }

  private buildApprovalInboxUserIdFieldClause(
    field: string,
    userId: string,
  ): Record<string, unknown> {
    const values = this.buildApprovalInboxUserIdValues(userId);

    return values.length === 1
      ? { [field]: values[0] }
      : { [field]: { $in: values } };
  }

  private buildApprovalInboxBossIdentityClause(
    userId: string,
    viewerLogin?: string,
  ): Record<string, unknown> {
    const clauses: Record<string, unknown>[] = [
      this.buildApprovalInboxUserIdFieldClause('boss.userId', userId),
    ];
    const loginClause = this.buildApprovalInboxLoginFieldClause(
      'boss.login',
      viewerLogin,
    );

    if (loginClause) {
      clauses.push(loginClause);
    }

    return clauses.length === 1 ? clauses[0] : { $or: clauses };
  }

  private buildApprovalInboxCommissionIdentityClause(
    userId: string,
    viewerLogin?: string,
  ): Record<string, unknown> {
    const userIdValues = this.buildApprovalInboxUserIdValues(userId);
    const branches: Record<string, unknown>[] = [
      {
        commissionMembers: {
          $elemMatch: {
            userId: { $in: userIdValues },
          },
        },
      },
    ];
    const commissionLoginClause = viewerLogin
      ? {
          commissionMembers: {
            $elemMatch: this.buildApprovalInboxLoginFieldClause(
              'login',
              viewerLogin,
            )!,
          },
        }
      : null;

    if (commissionLoginClause) {
      branches.push(commissionLoginClause);
    }

    return branches.length === 1 ? branches[0] : { $or: branches };
  }

  /** Boshliq/komissiya — har qanday holatdagi arizalar (status cheklovi yo‘q). */
  private buildApprovalInboxAssignmentClause(
    userId: string,
    viewerLogin?: string,
  ): Record<string, unknown> {
    const userIdValues = this.buildApprovalInboxUserIdValues(userId);
    const branches: Record<string, unknown>[] = [
      this.buildApprovalInboxBossIdentityClause(userId, viewerLogin),
      this.buildApprovalInboxCommissionIdentityClause(userId, viewerLogin),
      { approvalParticipantUserIds: { $in: userIdValues } },
      {
        memberDecisions: {
          $elemMatch: {
            userId: { $in: userIdValues },
          },
        },
      },
    ];

    const memberLoginClause = viewerLogin
      ? {
          memberDecisions: {
            $elemMatch: this.buildApprovalInboxLoginFieldClause(
              'login',
              viewerLogin,
            )!,
          },
        }
      : null;

    if (memberLoginClause) {
      branches.push(memberLoginClause);
    }

    return { $or: branches };
  }

  private buildApprovalInboxDataFilters(
    query: QueryApprovalInboxDto,
  ): Record<string, unknown> {
    const clauses: Record<string, unknown>[] = [];

    if (query.structureId && Types.ObjectId.isValid(query.structureId)) {
      const structureObjectId = new Types.ObjectId(query.structureId);
      clauses.push({
        $or: [
          { 'applicantStructure.structureId': structureObjectId },
          { 'applicantStructure.structureId': query.structureId },
        ],
      });
    }

    appendDateRangeClause(clauses, 'createdAt', query.dateFrom, query.dateTo);

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

  private buildApprovalInboxFilter(
    query: QueryApprovalInboxDto,
    userId: string,
    _role?: UserRole,
    viewerLogin?: string,
  ): Record<string, unknown> {
    const clauses: Record<string, unknown>[] = [
      this.buildApprovalInboxAssignmentClause(userId, viewerLogin),
    ];
    const dataFilter = this.buildApprovalInboxDataFilters(query);

    if (Object.keys(dataFilter).length > 0) {
      clauses.push(dataFilter);
    }

    return clauses.length === 1 ? clauses[0] : { $and: clauses };
  }

  private async listApprovalInboxStructureFilters(
    userId: string,
    _role?: UserRole,
    viewerLogin?: string,
  ) {
    const matchStage = this.buildApprovalInboxAssignmentClause(
      userId,
      viewerLogin,
    );

    const rows = await this.purchaseRequestModel
      .aggregate<{
        _id: Types.ObjectId;
        shortName: string;
        fullName: string;
        requestCount: number;
      }>([
        { $match: matchStage },
        {
          $match: {
            'applicantStructure.structureId': { $exists: true, $ne: null },
          },
        },
        {
          $group: {
            _id: '$applicantStructure.structureId',
            shortName: { $first: '$applicantStructure.shortName' },
            fullName: { $first: '$applicantStructure.fullName' },
            requestCount: { $sum: 1 },
          },
        },
        { $sort: { shortName: 1 } },
      ])
      .exec();

    return rows.map((row) => ({
      id: String(row._id),
      shortName: row.shortName?.trim() || '—',
      fullName: row.fullName?.trim() || row.shortName?.trim() || 'Noma’lum tuzilma',
      requestCount: row.requestCount,
    }));
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

    const [deleteAllowed, updateAllowed, createAllowed, isViewerElevatedAdmin] =
      await Promise.all([
      this.hasPurchaseRequestDeletePermission(userId, role),
      this.hasPurchaseRequestUpdatePermission(userId, role),
      this.hasPurchaseRequestCreatePermission(userId, role),
      this.isUserElevatedAdmin(userId, role),
    ]);

    for (const item of items) {
      this.ensureLegacyFields(item);
      await this.reconcileCommissionStatus(item);
    }

    return {
      items: items.map((item) =>
        this.toPublic(item, userId, undefined, role, {
          deleteAllowed,
          updateAllowed,
          createAllowed,
          isViewerElevatedAdmin,
        }),
      ),
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
    viewerLogin?: string,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;
    const filter = this.buildApprovalInboxFilter(
      query,
      userId,
      role,
      viewerLogin,
    );

    const [items, total, structureFilters] = await Promise.all([
      this.purchaseRequestModel
        .find(filter)
        .sort({ updatedAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.purchaseRequestModel.countDocuments(filter).exec(),
      this.listApprovalInboxStructureFilters(userId, role, viewerLogin),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));

    for (const item of items) {
      this.ensureLegacyFields(item);
      await this.reconcileCommissionStatus(item);
    }

    return {
      items: items.map((item) =>
        this.toPublic(item, userId, undefined, role, {
          viewerLogin,
          approvalInboxView: true,
        }),
      ),
      total,
      page,
      limit,
      totalPages,
      structureFilters,
    };
  }

  async findByIdOrFail(
    id: string,
    userId?: string,
    role?: UserRole,
    options?: { purchasingView?: boolean; historyView?: boolean },
    viewerLogin?: string,
  ) {
    const request = await this.purchaseRequestModel.findById(id).exec();

    if (!request) {
      throw new NotFoundException('Ariza topilmadi');
    }

    this.ensureLegacyFields(request);

    if (userId) {
      if (options?.purchasingView) {
        this.assertPurchasingView(request);
      } else if (!options?.historyView) {
        this.assertCanAccess(request, userId, role, viewerLogin);
      }
    }

    await this.reconcileCommissionStatus(request);

    return request;
  }

  async findByIdPublic(
    id: string,
    userId: string,
    role?: UserRole,
    options?: { purchasingView?: boolean; historyView?: boolean },
    warehouseDispatch?: Parameters<
      typeof this.buildWarehouseMetaFromDispatch
    >[1],
    viewerLogin?: string,
  ) {
    const request = await this.findByIdOrFail(
      id,
      userId,
      role,
      options,
      viewerLogin,
    );

    const meta =
      warehouseDispatch !== undefined
        ? this.buildWarehouseMetaFromDispatch(request, warehouseDispatch)
        : undefined;

    const [approvalSubmitAllowed, deleteAllowed, updateAllowed, createAllowed, isViewerElevatedAdmin] =
      await Promise.all([
        this.hasApprovalSubmitPermission(userId, role),
        this.hasPurchaseRequestDeletePermission(userId, role),
        this.hasPurchaseRequestUpdatePermission(userId, role),
        this.hasPurchaseRequestCreatePermission(userId, role),
        this.isUserElevatedAdmin(userId, role),
      ]);

    return this.toPublic(request, userId, meta, role, {
      approvalSubmitAllowed,
      deleteAllowed,
      updateAllowed,
      createAllowed,
      isViewerElevatedAdmin,
      viewerLogin,
    });
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

    const [items, total, structureFilters] = await Promise.all([
      this.purchaseRequestModel
        .find(filter)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.purchaseRequestModel.countDocuments(filter).exec(),
      this.listPurchasingInboxStructureFilters(),
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
      structureFilters,
    };
  }

  private purchasingInboxStatuses(): PurchaseRequestStatus[] {
    return [
      PurchaseRequestStatus.PURCHASING,
      PurchaseRequestStatus.PURCHASED,
    ];
  }

  private async listPurchasingInboxStructureFilters() {
    const rows = await this.purchaseRequestModel
      .aggregate<{
        _id: Types.ObjectId;
        shortName: string;
        fullName: string;
        requestCount: number;
      }>([
        {
          $match: {
            status: { $in: this.purchasingInboxStatuses() },
            'applicantStructure.structureId': { $exists: true, $ne: null },
            ...this.buildPurchasingInboxQueueMatch(),
          },
        },
        {
          $group: {
            _id: '$applicantStructure.structureId',
            shortName: { $first: '$applicantStructure.shortName' },
            fullName: { $first: '$applicantStructure.fullName' },
            requestCount: { $sum: 1 },
          },
        },
        { $sort: { shortName: 1 } },
      ])
      .exec();

    return rows.map((row) => ({
      id: String(row._id),
      shortName: row.shortName?.trim() || '—',
      fullName: row.fullName?.trim() || row.shortName?.trim() || 'Noma’lum tuzilma',
      requestCount: row.requestCount,
    }));
  }

  private buildPurchasingInboxFilter(
    query: QueryPurchasingInboxDto,
  ): Record<string, unknown> {
    const clauses: Record<string, unknown>[] = [
      {
        status: {
          $in: this.purchasingInboxStatuses(),
        },
      },
      this.buildPurchasingInboxQueueMatch(),
    ];

    appendDateRangeClause(clauses, 'updatedAt', query.dateFrom, query.dateTo);

    if (query.structureId && Types.ObjectId.isValid(query.structureId)) {
      const structureObjectId = new Types.ObjectId(query.structureId);
      clauses.push({
        $or: [
          { 'applicantStructure.structureId': structureObjectId },
          { 'applicantStructure.structureId': query.structureId },
        ],
      });
    }

    const term = query.search?.trim();

    if (term) {
      clauses.push({ $or: this.buildSearchOr(term) });
    }

    return clauses.length === 1 ? clauses[0] : { $and: clauses };
  }

  private buildPurchasedInboxFilter(
    query: QueryPurchasingInboxDto,
  ): Record<string, unknown> {
    if (query.inboxType === 'unavailable') {
      const clauses: Record<string, unknown>[] = [
        { 'items.isPurchaseUnavailable': true },
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

      appendDateRangeClause(
        clauses,
        'items.purchaseUnavailableAt',
        query.dateFrom,
        query.dateTo,
      );

      const term = query.search?.trim();

      if (term) {
        clauses.push({ $or: this.buildSearchOr(term) });
      }

      return { $and: clauses };
    }

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
      { 'items.isPurchased': true },
      { purchase: { $exists: true } },
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

  async getSubmittedDocument(
    requestId: string,
    docType: 'bildirgi' | 'kelishuv',
    userId: string,
    role?: UserRole,
  ) {
    const request = await this.findByIdOrFail(requestId, userId, role);
    const file =
      docType === 'bildirgi'
        ? request.submittedBildirgi
        : request.submittedKelishuv;

    if (!file) {
      throw new NotFoundException('Tahrirlangan hujjat topilmadi');
    }

    const filePath = this.sessionDocumentsService.resolveRequestDocumentPath(
      requestId,
      file.storedName,
    );

    return { file, filePath };
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

    const file =
      request.purchase?.files.find(
        (entry) => entry.storedName === path.basename(storedName),
      ) ??
      (request.purchaseBatches ?? [])
        .flatMap((batch) => batch.files)
        .find((entry) => entry.storedName === path.basename(storedName));

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

    if (!this.canPurchasePendingItems(request)) {
      throw new BadRequestException(
        'Xarid qilinadigan tovarlar qolmadi yoki ariza ushbu bosqichda emas',
      );
    }

    if (request.status !== PurchaseRequestStatus.PURCHASING) {
      request.status = PurchaseRequestStatus.PURCHASING;
    }

    const vendorName = input.vendorName?.trim() ?? '';

    const links = (input.links ?? [])
      .map((link) => ({
        label: link.label?.trim() ?? '',
        url: link.url?.trim() ?? '',
      }))
      .filter((link) => link.url.length > 0);

    for (const link of links) {
      try {
        new URL(link.url);
      } catch {
        throw new BadRequestException(`Noto‘g‘ri havola: ${link.url}`);
      }
    }

    if (!input.purchasedItems.length) {
      throw new BadRequestException(
        'Kamida bitta tovar tanlab xarid qilish kerak',
      );
    }

    const purchasedIndexes = new Set<number>();
    const itemSubstitutions: NonNullable<
      HistoryStepEmbeddable['itemSubstitutions']
    > = [];

    for (const row of input.purchasedItems) {
      if (
        row.itemIndex < 0 ||
        row.itemIndex >= request.items.length ||
        purchasedIndexes.has(row.itemIndex)
      ) {
        throw new BadRequestException('Tovar tanlovi noto‘g‘ri');
      }

      const item = request.items[row.itemIndex];

      if (item.isPurchased) {
        throw new BadRequestException(
          `${row.itemIndex + 1}-tovar allaqachon xarid qilingan`,
        );
      }

      if (item.isPurchaseUnavailable) {
        throw new BadRequestException(
          `${row.itemIndex + 1}-tovar xarid qilib bo‘lmaydi deb belgilangan`,
        );
      }

      if (!Number.isFinite(row.amount) || row.amount < 1) {
        throw new BadRequestException('Tovar summalari noto‘g‘ri');
      }

      const requestedQuantity = item.quantity;
      const purchasedQuantity =
        row.quantity != null && row.quantity >= 1
          ? Math.round(row.quantity)
          : requestedQuantity;

      if (purchasedQuantity > requestedQuantity) {
        throw new BadRequestException(
          `${row.itemIndex + 1}-tovar uchun kiritilgan son so‘ralgan miqdordan ko‘p`,
        );
      }

      purchasedIndexes.add(row.itemIndex);
    }

    const purchaser = await this.usersService.findByIdOrFail(userId);
    const now = new Date();
    const batchId = randomUUID();
    const savedFiles = await this.purchaseRequestFilesService.saveUploadedFiles(
      String(request._id),
      files,
      input.fileLabels ?? [],
    );

    const newItemAmounts: Array<{
      itemIndex: number;
      amount: number;
      vatRate: number;
      vatAmount: number;
    }> = [];
    const remainingItemsToInsert: Array<{
      afterIndex: number;
      item: {
        name: string;
        characteristics: string;
        quantity: number;
        unit: string;
        manufacturingCountry: string;
        isPurchased: boolean;
        isPurchaseUnavailable: boolean;
      };
    }> = [];

    for (const row of input.purchasedItems) {
      const item = request.items[row.itemIndex];
      const originalSnapshot = {
        name: item.name.trim(),
        characteristics: item.characteristics.trim(),
        quantity: item.quantity,
        unit: item.unit?.trim() ?? '',
      };

      const nextName = row.name?.trim() || originalSnapshot.name;
      const nextCharacteristics =
        row.characteristics?.trim() || originalSnapshot.characteristics;
      const purchasedQuantity =
        row.quantity != null && row.quantity >= 1
          ? Math.round(row.quantity)
          : originalSnapshot.quantity;
      const nextUnit = row.unit?.trim() ?? originalSnapshot.unit;
      const amount = Math.round(row.amount);
      const vatRate = Math.round(row.vatRate ?? 0);
      const vatAmount = Math.round(row.vatAmount ?? 0);
      const isPartialQuantity = purchasedQuantity < originalSnapshot.quantity;

      if (isPartialQuantity) {
        remainingItemsToInsert.push({
          afterIndex: row.itemIndex,
          item: {
            name: originalSnapshot.name,
            characteristics: originalSnapshot.characteristics,
            quantity: originalSnapshot.quantity - purchasedQuantity,
            unit: originalSnapshot.unit,
            manufacturingCountry: item.manufacturingCountry?.trim() ?? '',
            isPurchased: false,
            isPurchaseUnavailable: false,
          },
        });
      }

      const isChanged =
        isPartialQuantity ||
        nextName !== originalSnapshot.name ||
        nextCharacteristics !== originalSnapshot.characteristics ||
        purchasedQuantity !== originalSnapshot.quantity ||
        nextUnit !== originalSnapshot.unit;

      if (isChanged) {
        if (!item.originalRequestedItem) {
          item.originalRequestedItem = { ...originalSnapshot };
        }

        itemSubstitutions.push({
          itemIndex: row.itemIndex,
          originalName: originalSnapshot.name,
          originalCharacteristics: originalSnapshot.characteristics,
          originalQuantity: originalSnapshot.quantity,
          originalUnit: originalSnapshot.unit,
          deliveredName: nextName,
          deliveredCharacteristics: nextCharacteristics,
          deliveredQuantity: purchasedQuantity,
          deliveredUnit: nextUnit,
          amount,
          vatRate,
          vatAmount,
        });
      }

      item.name = nextName;
      item.characteristics = nextCharacteristics;
      item.quantity = purchasedQuantity;
      item.unit = nextUnit;
      item.purchaseAmount = amount;
      item.purchaseVatRate = vatRate;
      item.purchaseVatAmount = vatAmount;
      item.isPurchased = true;
      item.purchasedAt = now;
      item.purchaseBatchId = batchId;

      newItemAmounts.push({ itemIndex: row.itemIndex, amount, vatRate, vatAmount });
    }

    remainingItemsToInsert
      .sort((left, right) => right.afterIndex - left.afterIndex)
      .forEach(({ afterIndex, item: remainingItem }) => {
        request.items.splice(afterIndex + 1, 0, remainingItem);
      });

    request.markModified('items');

    const purchaseBatch: PurchaseBatchEmbeddable = {
      batchId,
      comment: input.comment?.trim() ?? '',
      contractNumber: input.contractNumber?.trim() ?? '',
      organizationName: input.organizationName?.trim() ?? '',
      innOrPinfl: input.innOrPinfl?.trim() ?? '',
      innOrPinflType: input.innOrPinflType ?? '',
      links,
      files: savedFiles,
      itemAmounts: newItemAmounts,
      itemSubstitutions,
      purchasedById: new Types.ObjectId(userId),
      purchasedByDisplayName: purchaser.displayName || purchaser.login,
      purchasedByLogin: purchaser.login,
      purchasedAt: now,
    };

    request.purchaseBatches = [...(request.purchaseBatches ?? []), purchaseBatch];
    request.markModified('purchaseBatches');

    const existingPurchase = request.purchase;
    const mergedLinks = [...(existingPurchase?.links ?? []), ...links];
    const mergedFiles = [...(existingPurchase?.files ?? []), ...savedFiles];
    const mergedItemAmounts = [
      ...(existingPurchase?.itemAmounts ?? []),
      ...newItemAmounts,
    ];

    request.purchase = {
      vendorName: vendorName || existingPurchase?.vendorName || '',
      contractNumber:
        input.contractNumber?.trim() || existingPurchase?.contractNumber || '',
      organizationName:
        input.organizationName?.trim() || existingPurchase?.organizationName || '',
      innOrPinfl: input.innOrPinfl?.trim() || existingPurchase?.innOrPinfl || '',
      innOrPinflType:
        input.innOrPinflType || existingPurchase?.innOrPinflType || '',
      links: mergedLinks,
      files: mergedFiles,
      comment: input.comment?.trim() || existingPurchase?.comment || '',
      itemAmounts: mergedItemAmounts,
      purchasedById: new Types.ObjectId(userId),
      purchasedByDisplayName: purchaser.displayName || purchaser.login,
      purchasedByLogin: purchaser.login,
      purchasedAt: now,
    };
    request.markModified('purchase');

    const allResolved = this.areAllItemsResolved(request);
    request.status = allResolved
      ? PurchaseRequestStatus.PURCHASED
      : PurchaseRequestStatus.PURCHASING;

    request.history.push({
      type: allResolved
        ? HistoryStepType.PURCHASED
        : HistoryStepType.PARTIAL_PURCHASE,
      actorUserId: new Types.ObjectId(userId),
      actorDisplayName: purchaser.displayName || purchaser.login,
      actorLogin: purchaser.login,
      comment: input.comment?.trim() ?? '',
      purchasedItemIndexes: [...purchasedIndexes],
      itemSubstitutions,
      purchaseBatchId: batchId,
      contractNumber: input.contractNumber?.trim() ?? '',
      organizationName: input.organizationName?.trim() ?? '',
      innOrPinfl: input.innOrPinfl?.trim() ?? '',
      innOrPinflType: input.innOrPinflType ?? '',
      createdAt: now,
    });
    request.markModified('history');

    await request.save();

    this.emitPurchaseRequestChanged(request, 'updated');

    return this.toPublic(request, userId);
  }

  async updatePurchaseBatchContract(
    id: string,
    batchId: string,
    dto: {
      contractNumber?: string;
      organizationName?: string;
      innOrPinfl?: string;
      innOrPinflType?: '' | 'inn' | 'pinfl';
    },
    userId: string,
    role?: UserRole,
  ) {
    const request = await this.findByIdOrFail(id, userId, role, {
      purchasingView: true,
    });

    const batch =
      (request.purchaseBatches ?? []).find(
        (entry) => entry.batchId === batchId,
      ) ?? null;

    const contractNumber = dto.contractNumber?.trim() ?? '';
    const organizationName = dto.organizationName?.trim() ?? '';
    const innOrPinfl = dto.innOrPinfl?.trim() ?? '';
    const innOrPinflType = dto.innOrPinflType ?? '';

    if ((innOrPinflType && !innOrPinfl) || (!innOrPinflType && innOrPinfl)) {
      throw new BadRequestException(
        'INN yoki PINFL uchun avval turini tanlang, keyin raqamni kiriting',
      );
    }

    if (innOrPinflType === 'inn' && innOrPinfl.length !== 9) {
      throw new BadRequestException('INN 9 ta raqamdan iborat bo‘lishi kerak');
    }

    if (innOrPinflType === 'pinfl' && innOrPinfl.length !== 14) {
      throw new BadRequestException(
        'PINFL 14 ta raqamdan iborat bo‘lishi kerak',
      );
    }

    if (!batch) {
      if (batchId === 'legacy' && request.purchase) {
        request.purchase.contractNumber = contractNumber;
        request.purchase.organizationName = organizationName;
        request.purchase.innOrPinfl = innOrPinfl;
        request.purchase.innOrPinflType = innOrPinflType;
        request.markModified('purchase');

        const historyStep = this.findPurchaseHistoryStepForBatch(request, {
          batchId: 'legacy',
          purchasedAt: request.purchase.purchasedAt,
        } as PurchaseBatchEmbeddable);

        if (historyStep) {
          historyStep.contractNumber = contractNumber;
          historyStep.organizationName = organizationName;
          historyStep.innOrPinfl = innOrPinfl;
          historyStep.innOrPinflType = innOrPinflType;
          historyStep.purchaseBatchId = 'legacy';
          request.markModified('history');
        }

        await request.save();
        this.emitPurchaseRequestChanged(request, 'updated');
        return this.toPublic(request, userId);
      }

      throw new NotFoundException('Xarid partiyasi topilmadi');
    }

    batch.contractNumber = contractNumber;
    batch.organizationName = organizationName;
    batch.innOrPinfl = innOrPinfl;
    batch.innOrPinflType = innOrPinflType;
    request.markModified('purchaseBatches');

    if (request.purchase) {
      request.purchase.contractNumber = contractNumber;
      request.purchase.organizationName = organizationName;
      request.purchase.innOrPinfl = innOrPinfl;
      request.purchase.innOrPinflType = innOrPinflType;
      request.markModified('purchase');
    }

    const historyStep = this.findPurchaseHistoryStepForBatch(request, batch);
    if (historyStep) {
      historyStep.contractNumber = contractNumber;
      historyStep.organizationName = organizationName;
      historyStep.innOrPinfl = innOrPinfl;
      historyStep.innOrPinflType = innOrPinflType;
      if (!historyStep.purchaseBatchId) {
        historyStep.purchaseBatchId = batchId;
      }
      request.markModified('history');
    }

    await request.save();

    this.emitPurchaseRequestChanged(request, 'updated');

    return this.toPublic(request, userId);
  }

  private findPurchaseHistoryStepForBatch(
    request: PurchaseRequestDocument,
    batch: PurchaseBatchEmbeddable,
  ) {
    const purchaseSteps = (request.history ?? []).filter(
      (step) =>
        step.type === HistoryStepType.PURCHASED ||
        step.type === HistoryStepType.PARTIAL_PURCHASE,
    );

    if (!purchaseSteps.length) {
      return null;
    }

    const byBatchId = purchaseSteps.find(
      (step) => step.purchaseBatchId === batch.batchId,
    );
    if (byBatchId) {
      return byBatchId;
    }

    const batchTime = new Date(batch.purchasedAt).getTime();
    const byTime = purchaseSteps.find((step) => {
      const stepTime = new Date(step.createdAt).getTime();
      return Math.abs(stepTime - batchTime) <= 2000;
    });

    return byTime ?? purchaseSteps[purchaseSteps.length - 1];
  }

  async markItemsUnavailable(
    id: string,
    dto: MarkItemsUnavailableDto,
    userId: string,
    role?: UserRole,
  ) {
    const request = await this.findByIdOrFail(id, userId, role, {
      purchasingView: true,
    });

    if (!this.canPurchasePendingItems(request)) {
      throw new BadRequestException(
        'Xarid qilinadigan tovarlar qolmadi yoki ariza ushbu bosqichda emas',
      );
    }

    if (request.status !== PurchaseRequestStatus.PURCHASING) {
      request.status = PurchaseRequestStatus.PURCHASING;
    }

    const comment = dto.comment.trim();

    if (comment.length < 5) {
      throw new BadRequestException(
        'Xarid qilinmaganlik sababi kamida 5 belgidan iborat bo‘lishi kerak',
      );
    }

    const unavailableRows =
      dto.unavailableItems?.length
        ? dto.unavailableItems
        : (dto.itemIndexes ?? []).map((itemIndex) => ({ itemIndex, quantity: undefined }));

    if (!unavailableRows.length) {
      throw new BadRequestException('Kamida bitta tovar tanlang');
    }

    const seenIndexes = new Set<number>();

    for (const row of unavailableRows) {
      if (
        row.itemIndex < 0 ||
        row.itemIndex >= request.items.length ||
        seenIndexes.has(row.itemIndex)
      ) {
        throw new BadRequestException('Tovar tanlovi noto‘g‘ri');
      }

      const item = request.items[row.itemIndex];

      if (item.isPurchased) {
        throw new BadRequestException(
          `${row.itemIndex + 1}-tovar allaqachon xarid qilingan`,
        );
      }

      if (item.isPurchaseUnavailable) {
        throw new BadRequestException(
          `${row.itemIndex + 1}-tovar allaqachon xarid qilib bo‘lmaydi deb belgilangan`,
        );
      }

      const requestedQuantity = item.quantity;
      const unavailableQuantity =
        row.quantity != null && row.quantity >= 1
          ? Math.round(row.quantity)
          : requestedQuantity;

      if (unavailableQuantity > requestedQuantity) {
        throw new BadRequestException(
          `${row.itemIndex + 1}-tovar uchun kiritilgan son so‘ralgan miqdordan ko‘p`,
        );
      }

      seenIndexes.add(row.itemIndex);
    }

    const actor = await this.usersService.findByIdOrFail(userId);
    const now = new Date();
    const batchId = randomUUID();
    const markedIndexes: number[] = [];
    const remainingItemsToInsert: Array<{
      afterIndex: number;
      item: {
        name: string;
        characteristics: string;
        quantity: number;
        unit: string;
        manufacturingCountry: string;
        isPurchased: boolean;
        isPurchaseUnavailable: boolean;
      };
    }> = [];

    for (const row of unavailableRows) {
      const item = request.items[row.itemIndex];
      const originalSnapshot = {
        name: item.name.trim(),
        characteristics: item.characteristics.trim(),
        quantity: item.quantity,
        unit: item.unit?.trim() ?? '',
      };
      const unavailableQuantity =
        row.quantity != null && row.quantity >= 1
          ? Math.round(row.quantity)
          : originalSnapshot.quantity;

      if (unavailableQuantity < originalSnapshot.quantity) {
        remainingItemsToInsert.push({
          afterIndex: row.itemIndex,
          item: {
            name: originalSnapshot.name,
            characteristics: originalSnapshot.characteristics,
            quantity: originalSnapshot.quantity - unavailableQuantity,
            unit: originalSnapshot.unit,
            manufacturingCountry: item.manufacturingCountry?.trim() ?? '',
            isPurchased: false,
            isPurchaseUnavailable: false,
          },
        });
        item.quantity = unavailableQuantity;
      }

      item.isPurchaseUnavailable = true;
      item.purchaseUnavailableReason = comment;
      item.purchaseUnavailableAt = now;
      item.purchaseUnavailableBatchId = batchId;
      markedIndexes.push(row.itemIndex);
    }

    remainingItemsToInsert
      .sort((left, right) => right.afterIndex - left.afterIndex)
      .forEach(({ afterIndex, item: remainingItem }) => {
        request.items.splice(afterIndex + 1, 0, remainingItem);
      });

    request.markModified('items');

    const unavailableBatch: PurchaseUnavailableBatchEmbeddable = {
      batchId,
      comment,
      itemIndexes: markedIndexes,
      markedById: new Types.ObjectId(userId),
      markedByDisplayName: actor.displayName || actor.login,
      markedByLogin: actor.login,
      markedAt: now,
    };

    request.purchaseUnavailableBatches = [
      ...(request.purchaseUnavailableBatches ?? []),
      unavailableBatch,
    ];
    request.markModified('purchaseUnavailableBatches');

    const allResolved = this.areAllItemsResolved(request);
    request.status = allResolved
      ? PurchaseRequestStatus.PURCHASED
      : PurchaseRequestStatus.PURCHASING;

    request.history.push({
      type: HistoryStepType.ITEMS_UNAVAILABLE,
      actorUserId: new Types.ObjectId(userId),
      actorDisplayName: actor.displayName || actor.login,
      actorLogin: actor.login,
      comment,
      unavailableItemIndexes: markedIndexes,
      createdAt: now,
    });

    if (allResolved) {
      request.history.push({
        type: HistoryStepType.PURCHASED,
        actorUserId: new Types.ObjectId(userId),
        actorDisplayName: actor.displayName || actor.login,
        actorLogin: actor.login,
        comment: 'Barcha tovarlar xarid qilindi yoki xarid qilib bo‘lmaydi deb belgilandi',
        createdAt: now,
      });
    }

    request.markModified('history');

    await request.save();

    this.emitPurchaseRequestChanged(request, 'updated');

    return this.toPublic(request, userId);
  }

  async rejectPurchase(
    id: string,
    dto: RejectPurchaseDto,
    userId: string,
    role?: UserRole,
  ) {
    const request = await this.findByIdOrFail(id, userId, role, {
      purchasingView: true,
    });

    if (request.status !== PurchaseRequestStatus.PURCHASING) {
      throw new BadRequestException(
        'Faqat sotib olinadigan bosqichdagi arizani rad etish mumkin',
      );
    }

    const reasonLabel = PURCHASE_REJECTION_REASON_LABELS[dto.reasonKey];
    const comment = dto.comment?.trim() ?? '';

    if (dto.reasonKey === 'OTHER' && !comment) {
      throw new BadRequestException('«Boshqa» sabab uchun izoh kiriting');
    }

    const actor = await this.usersService.findByIdOrFail(userId);
    const now = new Date();
    const historyComment = comment ? `${reasonLabel}. ${comment}` : reasonLabel;

    request.status = PurchaseRequestStatus.REJECTED;
    request.history.push({
      type: HistoryStepType.PURCHASE_REJECTED,
      actorUserId: new Types.ObjectId(userId),
      actorDisplayName: actor.displayName || actor.login,
      actorLogin: actor.login,
      comment: historyComment,
      rejectionReasonKey: dto.reasonKey,
      createdAt: now,
    });
    request.markModified('history');

    await request.save();

    this.emitPurchaseRequestChanged(request, 'updated');

    return this.toPublic(request, userId);
  }

  private async ensureSessionRequestCode(
    session: PurchaseRequestSessionDocument,
    userId: string,
  ): Promise<string> {
    if (session.editingRequestId) {
      const request = await this.purchaseRequestModel
        .findById(session.editingRequestId)
        .select('requestCode')
        .exec();

      const editingCode = request?.requestCode?.trim().toUpperCase();
      if (editingCode) {
        session.reservedRequestCode = editingCode;
        await session.save();
        return editingCode;
      }
    }

    const applicantStructure =
      await this.usersService.resolveStructureSnapshotForUser(userId);

    const existing = session.reservedRequestCode?.trim().toUpperCase();
    if (existing && !(await this.isRequestCodeTaken(existing))) {
      return existing;
    }

    const requestCode = await this.allocateUniqueRequestCode(
      applicantStructure?.shortName,
      applicantStructure?.structureId,
    );

    session.reservedRequestCode = requestCode;
    await session.save();

    return requestCode;
  }

  private async createPurchaseRequestRecord(
    dto: CreatePurchaseRequestDto,
    createdById: string,
    options?: { requestCode?: string },
  ): Promise<PurchaseRequestDocument> {
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
      position: applicantUser.position?.trim() ?? '',
    };

    const applicantStructure =
      await this.usersService.resolveStructureSnapshotForUser(createdById);

    const commissionMembers = await this.buildUserSnapshots(
      dto.commissionMemberIds,
    );
    const [boss] = await this.buildUserSnapshots([dto.bossId]);

    let requestCode = options?.requestCode?.trim().toUpperCase();
    if (!requestCode || (await this.isRequestCodeTaken(requestCode))) {
      requestCode = await this.allocateUniqueRequestCode(
        applicantStructure?.shortName,
        applicantStructure?.structureId,
      );
    }

    let number = await this.nextNumber();
    const comment = dto.comment?.trim() ?? '';
    const commissionAgreementText = dto.commissionAgreementText?.trim() ?? '';

    if (dto.purchaseDeadlineMandatory && !dto.purchaseDeadline) {
      throw new BadRequestException(
        'Muddat majburiy deb belgilangan — sanani tanlang',
      );
    }

    validatePurchasePeriod(dto);
    const purchasePeriod = normalizePurchasePeriodFields(dto);

    const purchaseDeadline = this.parsePurchaseDeadline(dto.purchaseDeadline);
    const purchaseDeadlineMandatory = purchaseDeadline
      ? Boolean(dto.purchaseDeadlineMandatory)
      : false;

    const payload = {
      commissionMembers,
      boss,
      items: this.normalizeRequestItems(dto.items),
      comment,
      commissionAgreementText,
      purchaseDeadline,
      purchaseDeadlineMandatory,
      ...purchasePeriod,
      createdById: new Types.ObjectId(createdById),
      applicant: applicantSnapshot,
      applicantStructure: applicantStructure
        ? {
            structureId: new Types.ObjectId(applicantStructure.structureId),
            fullName: applicantStructure.fullName,
            shortName: applicantStructure.shortName,
            leaderName: applicantStructure.leaderName?.trim() || '',
            capturedAt: applicantStructure.capturedAt,
          }
        : undefined,
      memberDecisions: this.buildMemberDecisions(commissionMembers),
      history: [
        this.buildSubmittedHistoryStep(
          applicantSnapshot,
          comment,
          purchaseDeadline,
          purchaseDeadlineMandatory,
        ),
      ],
    };

    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        const request = await this.purchaseRequestModel.create({
          number,
          requestCode,
          ...payload,
        });
        this.syncApprovalParticipantUserIds(request);
        await request.save();

        return request;
      } catch (error) {
        if (!(error instanceof MongoServerError) || error.code !== 11000) {
          throw error;
        }

        const duplicateField = String(error.message ?? '').toLowerCase();

        if (duplicateField.includes('requestcode') && attempt < 5) {
          requestCode = await this.allocateUniqueRequestCode(
            applicantStructure?.shortName,
            applicantStructure?.structureId,
          );
          continue;
        }

        if (duplicateField.includes('number') && attempt < 5) {
          number = await this.nextNumber();
          continue;
        }

        throw new ConflictException(
          'Ariza yaratishda xatolik yuz berdi. Qayta urinib ko‘ring',
        );
      }
    }

    throw new ConflictException(
      'Ariza yaratishda xatolik yuz berdi. Qayta urinib ko‘ring',
    );
  }

  async create(dto: CreatePurchaseRequestDto, createdById: string) {
    const request = await this.createPurchaseRequestRecord(dto, createdById);

    this.emitPurchaseRequestChanged(request, 'created');

    return this.toPublic(request, createdById);
  }

  async update(
    id: string,
    dto: UpdatePurchaseRequestDto,
    userId: string,
    role?: UserRole,
  ) {
    await this.assertPurchaseRequestUpdatePermission(userId, role);

    const priorDecisions = await this.loadStoredMemberDecisionsForEdit(id);

    const request = await this.findByIdOrFail(id, userId, role);

    await this.assertCanEditPurchaseRequest(request, userId, role);

    if (dto.commissionMemberIds.includes(dto.bossId)) {
      throw new BadRequestException(
        'Boshliq komissiya a’zolari ro‘yxatida bo‘lmasligi kerak',
      );
    }

    if (dto.purchaseDeadlineMandatory && !dto.purchaseDeadline) {
      throw new BadRequestException(
        'Muddat majburiy deb belgilangan — sanani tanlang',
      );
    }

    const commissionMembers = await this.buildUserSnapshots(
      dto.commissionMemberIds,
    );
    const [boss] = await this.buildUserSnapshots([dto.bossId]);
    const comment = dto.comment?.trim() ?? '';
    const commissionAgreementText = dto.commissionAgreementText?.trim() ?? '';
    validatePurchasePeriod(dto);
    const purchasePeriod = normalizePurchasePeriodFields(dto);

    const purchaseDeadline = this.parsePurchaseDeadline(dto.purchaseDeadline);
    const purchaseDeadlineMandatory = purchaseDeadline
      ? Boolean(dto.purchaseDeadlineMandatory)
      : false;
    const now = new Date();
    const hadPriorDecisions = priorDecisions.some((vote) =>
      Boolean(vote.decision),
    );

    request.commissionMembers = commissionMembers;
    request.boss = boss;
    request.items = this.normalizeRequestItems(dto.items);
    request.comment = comment;
    request.commissionAgreementText = commissionAgreementText;
    request.purchaseDeadline = purchaseDeadline;
    request.purchaseDeadlineMandatory = purchaseDeadlineMandatory;
    request.purchasePeriodType = purchasePeriod.purchasePeriodType;
    request.purchasePeriodYear = purchasePeriod.purchasePeriodYear;
    request.purchasePeriodQuarter = purchasePeriod.purchasePeriodQuarter;
    request.purchasePeriodMonth = purchasePeriod.purchasePeriodMonth;
    const nextMemberDecisions = this.preserveMemberDecisionsAfterEdit(
      commissionMembers,
      priorDecisions,
    );
    request.memberDecisions = nextMemberDecisions;
    request.markModified('memberDecisions');
    request.markModified('items');

    const needsCommissionRedecision = nextMemberDecisions.some(
      (vote) => !this.isMemberFullyApproved(vote.decision),
    );

    if (request.bossDecision || needsCommissionRedecision) {
      this.clearBossDecision(request);
    }

    request.resubmittedAfterPartialAt = needsCommissionRedecision
      ? now
      : undefined;

    request.status = needsCommissionRedecision
      ? PurchaseRequestStatus.COMMISSION_REVIEW
      : PurchaseRequestStatus.BOSS_DECISION_PENDING;

    const historyNote = needsCommissionRedecision
      ? 'Rad etgan yoki qisman kelishgan a’zolar qayta qaror berishi kerak. To‘liq kelishgan a’zolar qarori saqlanadi.'
      : hadPriorDecisions
        ? 'Komissiya to‘liq kelishgan — boshliq qarori kutilmoqda.'
        : '';

    const historyComment = historyNote
      ? comment
        ? `${comment}\n\n(${historyNote})`
        : historyNote
      : comment;

    request.history.push({
      type: HistoryStepType.UPDATED,
      actorUserId: request.applicant.userId,
      actorDisplayName: request.applicant.displayName,
      actorLogin: request.applicant.login,
      comment: historyComment,
      purchaseDeadline: purchaseDeadline ?? undefined,
      purchaseDeadlineMandatory: purchaseDeadline
        ? purchaseDeadlineMandatory
        : undefined,
      createdAt: now,
    });
    request.markModified('history');

    this.syncApprovalParticipantUserIds(request);
    await request.save();

    this.emitPurchaseRequestChanged(request, 'updated');

    const [deleteAllowed, updateAllowed] = await Promise.all([
      this.hasPurchaseRequestDeletePermission(userId, role),
      this.hasPurchaseRequestUpdatePermission(userId, role),
    ]);

    return this.toPublic(request, userId, undefined, role, {
      deleteAllowed,
      updateAllowed,
    });
  }

  async updateWithDocuments(
    id: string,
    dto: UpdatePurchaseRequestDto,
    userId: string,
    role: UserRole | undefined,
    files: {
      bildirgi?: Express.Multer.File;
      kelishuv?: Express.Multer.File;
    },
  ) {
    if (!files?.bildirgi?.buffer?.length || !files?.kelishuv?.buffer?.length) {
      throw new BadRequestException(
        'Bildirgi va kelishuv Word fayllari yuborilishi shart',
      );
    }

    this.assertSubmittedDocxUpload(files.bildirgi);
    this.assertSubmittedDocxUpload(files.kelishuv);

    await this.update(id, dto, userId, role);

    const request = await this.findByIdOrFail(id, userId, role);

    const submittedDocuments =
      await this.sessionDocumentsService.saveSubmittedDocumentsToRequest(
        id,
        request.requestCode,
        {
          bildirgi: files.bildirgi.buffer,
          kelishuv: files.kelishuv.buffer,
        },
      );

    request.submittedBildirgi = submittedDocuments.bildirgi;
    request.submittedKelishuv = submittedDocuments.kelishuv;
    await request.save();

    this.emitPurchaseRequestChanged(request, 'updated');

    const [deleteAllowed, updateAllowed] = await Promise.all([
      this.hasPurchaseRequestDeletePermission(userId, role),
      this.hasPurchaseRequestUpdatePermission(userId, role),
    ]);

    return this.toPublic(request, userId, undefined, role, {
      deleteAllowed,
      updateAllowed,
    });
  }

  async createEditSession(userId: string, requestId: string, role?: UserRole) {
    await this.assertPurchaseRequestUpdatePermission(userId, role);

    const request = await this.findByIdOrFail(requestId, userId, role);

    await this.assertCanEditPurchaseRequest(request, userId, role);

    const userObjectId = new Types.ObjectId(userId);
    const total = await this.purchaseRequestSessionModel
      .countDocuments({ userId: userObjectId })
      .exec();

    if (total >= MAX_ACTIVE_SESSIONS_PER_USER) {
      throw new BadRequestException(
        `Ko‘pi bilan ${MAX_ACTIVE_SESSIONS_PER_USER} ta faol seans bo‘lishi mumkin`,
      );
    }

    const session = await this.purchaseRequestSessionModel.create({
      userId: userObjectId,
      editingRequestId: new Types.ObjectId(requestId),
      reservedRequestCode: request.requestCode,
      title: `Tahrir: ${request.requestCode}`,
      commissionMemberIds: request.commissionMembers.map((member) => member.userId),
      bossId: request.boss.userId,
      items: request.items.map((item) => ({
        name: item.name,
        characteristics: item.characteristics,
        quantity: item.quantity,
        unit: item.unit ?? '',
        manufacturingCountry: item.manufacturingCountry ?? '',
      })),
      comment: request.comment ?? '',
      commissionAgreementText: request.commissionAgreementText ?? '',
      purchasePeriodType: request.purchasePeriodType,
      purchasePeriodYear: request.purchasePeriodYear,
      purchasePeriodQuarter: request.purchasePeriodQuarter,
      purchasePeriodMonth: request.purchasePeriodMonth,
      documentToken: this.sessionDocumentsService.createDocumentToken(),
      applicantVerificationToken:
        request.applicantVerificationToken ??
        this.sessionDocumentsService.createApplicantVerificationToken(),
    });

    const sessionId = String(session._id);
    let documentsReady = false;

    if (request.submittedBildirgi && request.submittedKelishuv) {
      try {
        const hasDocxFiles =
          await this.sessionDocumentsService.requestHasSubmittedDocxFiles(
            request,
          );

        if (hasDocxFiles) {
          await this.sessionDocumentsService.copyRequestDocumentsToSession(
            requestId,
            sessionId,
            {
              bildirgi: request.submittedBildirgi,
              kelishuv: request.submittedKelishuv,
            },
          );
          documentsReady = true;
        }
      } catch (error) {
        this.logger.warn(
          `Ariza ${requestId} hujjatlarini seansga nusxalab bo‘lmadi — qayta yaratiladi`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    if (!documentsReady) {
      await this.sessionDocumentsService.prepareSessionDocuments(
        session,
        userId,
        sessionId,
        session.applicantVerificationToken!,
        request.requestCode,
      );
    }

    const version = Date.now();
    session.documentsPreparedAt = new Date();
    session.documentVersions = {
      bildirgi: version,
      kelishuv: version,
    };
    await session.save();

    return this.toSessionPublic(session, total + 1);
  }

  async submitDecision(
    id: string,
    dto: SubmitApprovalDecisionDto,
    userId: string,
    role?: UserRole,
  ) {
    await this.assertApprovalSubmitPermission(userId, role);

    const request = await this.findByIdOrFail(id, userId, role);

    if (!this.isCommissionMember(request, userId)) {
      throw new ForbiddenException(
        'Faqat komissiya a’zosi qaror berishi mumkin',
      );
    }

    if (request.status === PurchaseRequestStatus.REJECTED) {
      throw new BadRequestException(
        'Rad etilgan arizaga qaror berib bo‘lmaydi',
      );
    }

    if (this.isApprovalWorkflowClosed(request)) {
      throw new BadRequestException(
        'Boshliq tasdiqlagan arizaga komissiya qarori qabul qilinmaydi',
      );
    }

    if (
      request.status === PurchaseRequestStatus.PURCHASING ||
      request.status === PurchaseRequestStatus.PURCHASED
    ) {
      throw new BadRequestException(
        'Yakunlangan arizaga qaror berib bo‘lmaydi',
      );
    }

    if (!this.isCommissionReviewOpen(request)) {
      throw new BadRequestException(
        'Hozirgi bosqichda komissiya qarori qabul qilinmaydi',
      );
    }

    const decisionIndex = request.memberDecisions.findIndex(
      (decision) =>
        this.normalizeUserId(decision.userId) === this.normalizeUserId(userId),
    );

    if (decisionIndex < 0) {
      throw new ForbiddenException(
        'Siz ushbu arizaning komissiya a’zosi emassiz',
      );
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

    if (dto.decision === ApprovalDecision.REJECTED) {
      request.resubmittedAfterPartialAt = undefined;
    }

    this.syncMemberDecisionsWithCommission(request);
    request.status = this.recomputeStatus(request);
    this.syncApprovalParticipantUserIds(request);
    await request.save();

    if (dto.decision === ApprovalDecision.REJECTED) {
      await this.notificationsEvents.notifyPurchaseRequestCommissionRejection(
        request,
      );
    }

    this.emitPurchaseRequestChanged(request, 'updated');

    return this.toPublic(request, userId);
  }

  async resubmit(
    id: string,
    dto: ResubmitPurchaseRequestDto,
    userId: string,
    role?: UserRole,
    options?: { skipKelishuvRegeneration?: boolean },
  ) {
    await this.assertPurchaseRequestUpdatePermission(userId, role);

    const request = await this.findByIdOrFail(id, userId, role);

    if (!this.isApplicant(request, userId)) {
      throw new ForbiddenException(
        'Faqat ariza beruvchi qayta yuborishi mumkin',
      );
    }

    const isBossResubmit =
      dto.resubmitTarget === 'boss' ||
      this.isBossRejectionPendingResubmit(request);

    if (isBossResubmit) {
      if (!this.isBossRejectionPendingResubmit(request)) {
        throw new BadRequestException(
          'Boshliqqa qayta yuborish faqat boshliq rad etgan va komissiya kelishgan holatda mumkin',
        );
      }

      const comment = dto.comment?.trim() ?? '';
      const now = new Date();

      await this.applyResubmitFieldsToRequest(request, dto);
      this.clearBossDecision(request);
      request.status = PurchaseRequestStatus.BOSS_DECISION_PENDING;

      request.history.push({
        type: HistoryStepType.RESUBMITTED,
        actorUserId: request.applicant.userId,
        actorDisplayName: request.applicant.displayName,
        actorLogin: request.applicant.login,
        comment: comment || 'Boshliqqa qayta yuborildi',
        createdAt: now,
      });
      request.markModified('history');

      await request.save();

      await this.regenerateKelishuvAfterResubmitIfNeeded(request, {
        skipWhenDocumentsProvided: options?.skipKelishuvRegeneration,
      });

      this.emitPurchaseRequestChanged(request, 'updated');

      return this.toPublic(request, userId);
    }

    if (!this.isCommissionResubmitPhase(request)) {
      throw new BadRequestException(
        'Faqat kelishuv bosqichidagi arizani qayta yuborish mumkin',
      );
    }

    const rejectedMemberIds = (request.memberDecisions ?? [])
      .filter((decision) => decision.decision === ApprovalDecision.REJECTED)
      .map((decision) => String(decision.userId));

    if (!rejectedMemberIds.length) {
      throw new BadRequestException(
        'Qayta yuborish uchun rad etgan komissiya a’zosi topilmadi',
      );
    }

    const selectedMemberIds = [
      ...new Set((dto.resubmitToMemberIds ?? []).map(String)),
    ];

    if (!selectedMemberIds.length) {
      throw new BadRequestException(
        'Qayta kelishish uchun kamida bitta rad etgan a’zoni tanlang',
      );
    }

    if (
      selectedMemberIds.some((memberId) => !rejectedMemberIds.includes(memberId))
    ) {
      throw new BadRequestException(
        'Faqat rad etgan komissiya a’zolarini tanlash mumkin',
      );
    }

    const comment = dto.comment?.trim() ?? '';
    const now = new Date();

    await this.applyResubmitFieldsToRequest(request, dto);
    request.memberDecisions = this.preserveMemberDecisionsAfterResubmit(
      request,
      selectedMemberIds,
    );
    request.markModified('memberDecisions');
    this.clearBossDecision(request);
    request.resubmittedAfterPartialAt = now;
    request.status = this.recomputeStatus(request);
    if (request.status === PurchaseRequestStatus.PARTIAL_REVISION) {
      request.status = PurchaseRequestStatus.COMMISSION_REVIEW;
    }

    request.history.push({
      type: HistoryStepType.RESUBMITTED,
      actorUserId: request.applicant.userId,
      actorDisplayName: request.applicant.displayName,
      actorLogin: request.applicant.login,
      comment,
      createdAt: now,
    });
    request.markModified('history');

    await request.save();

    await this.regenerateKelishuvAfterResubmitIfNeeded(request, {
      skipWhenDocumentsProvided: options?.skipKelishuvRegeneration,
    });

    this.emitPurchaseRequestChanged(request, 'updated');

    return this.toPublic(request, userId);
  }

  async resubmitWithDocuments(
    id: string,
    dto: ResubmitPurchaseRequestDto,
    userId: string,
    role: UserRole | undefined,
    files: {
      bildirgi?: Express.Multer.File;
      kelishuv?: Express.Multer.File;
    },
  ) {
    if (!files?.bildirgi?.buffer?.length || !files?.kelishuv?.buffer?.length) {
      throw new BadRequestException(
        'Bildirgi va kelishuv Word fayllari yuborilishi shart',
      );
    }

    this.assertSubmittedDocxUpload(files.bildirgi);
    this.assertSubmittedDocxUpload(files.kelishuv);

    const result = await this.resubmit(id, dto, userId, role, {
      skipKelishuvRegeneration: true,
    });
    void result;
    const request = await this.findByIdOrFail(id, userId, role);

    const submittedDocuments =
      await this.sessionDocumentsService.saveSubmittedDocumentsToRequest(
        id,
        request.requestCode,
        {
          bildirgi: files.bildirgi.buffer,
          kelishuv: files.kelishuv.buffer,
        },
      );

    request.submittedBildirgi = submittedDocuments.bildirgi;
    request.submittedKelishuv = submittedDocuments.kelishuv;
    await request.save();

    this.emitPurchaseRequestChanged(request, 'updated');

    const [deleteAllowed, updateAllowed] = await Promise.all([
      this.hasPurchaseRequestDeletePermission(userId, role),
      this.hasPurchaseRequestUpdatePermission(userId, role),
    ]);

    return this.toPublic(request, userId, undefined, role, {
      deleteAllowed,
      updateAllowed,
    });
  }

  async confirmBossDecision(
    id: string,
    dto: ConfirmBossDecisionDto,
    userId: string,
    role?: UserRole,
    userLogin?: string,
  ) {
    const request = await this.findByIdOrFail(id, userId, role, undefined, userLogin);

    if (!this.isBoss(request, userId, userLogin)) {
      throw new ForbiddenException('Faqat boshliq qaror berishi mumkin');
    }

    if (this.isApprovalWorkflowClosed(request)) {
      throw new BadRequestException('Ariza allaqachon tasdiqlangan yoki yakunlangan');
    }

    await this.reconcileCommissionStatus(request);
    this.syncMemberDecisionsWithCommission(request);

    if (!this.isBossDecisionPhase(request)) {
      if (!this.areAllCommissionMembersAgreed(request)) {
        throw new BadRequestException(
          'Boshliq qarorini berish uchun barcha komissiya a’zolari kelishishi kerak',
        );
      }

      throw new BadRequestException(
        'Boshliq qarorini hozirgi bosqichda berib bo‘lmaydi',
      );
    }

    if (dto.decision === ApprovalDecision.PARTIAL) {
      throw new BadRequestException(
        'Boshliq uchun qisman kelishish mavjud emas',
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

    this.syncApprovalParticipantUserIds(request);
    await request.save();

    if (dto.decision === ApprovalDecision.APPROVED) {
      try {
        const submittedDocuments =
          await this.sessionDocumentsService.convertSubmittedDocumentsToPdf(
            request,
          );
        request.submittedBildirgi = submittedDocuments.bildirgi;
        request.submittedKelishuv = submittedDocuments.kelishuv;
        this.syncApprovalParticipantUserIds(request);
        await request.save();
      } catch (error) {
        this.logger.error(
          `Ariza ${request.id} hujjatlarini PDF ga aylantirishda xatolik`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    this.emitPurchaseRequestChanged(request, 'updated');

    return this.toPublic(request, userId, undefined, role, { viewerLogin: userLogin });
  }

  async remove(id: string, userId: string, role?: UserRole) {
    await this.assertPurchaseRequestDeletePermission(userId, role);

    const request = await this.findByIdOrFail(id, userId, role);

    if (!this.canDeleteRequest(request, userId, role)) {
      if (request.status !== PurchaseRequestStatus.COMMISSION_REVIEW) {
        throw new ForbiddenException(
          'Arizani faqat «Kelishilmoqda» holatida o‘chirish mumkin',
        );
      }

      throw new ForbiddenException(
        'Arizani faqat yuborilgandan keyin 24 soat ichida o‘chirish mumkin',
      );
    }

    const dispatches =
      await this.warehouseDispatchesService.findAllByPurchaseRequestId(id);

    if (dispatches.length) {
      throw new BadRequestException(
        'Ushbu ariza omborga bog‘langan. Avval ombor jo‘natmalarini hal qiling',
      );
    }

    await this.purchaseRequestFilesService.deleteRequestFiles(id);
    await this.purchaseRequestModel.findByIdAndDelete(id).exec();
    this.purchaseRequestsEvents.notifyDeleted(request);

    return { id, deleted: true };
  }

  async polishPurchaseItemText(name: string, characteristics: string) {
    const trimmedName = name.trim();
    const trimmedCharacteristics = characteristics.trim();

    if (!trimmedName || !trimmedCharacteristics) {
      throw new BadRequestException('Nomi va xususiyati to‘ldirilishi kerak');
    }

    return this.purchaseRequestAiService.polishItemText(
      trimmedName,
      trimmedCharacteristics,
    );
  }

  async listActiveSessions(userId: string) {
    const sessions = await this.purchaseRequestSessionModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ updatedAt: -1 })
      .exec();

    return {
      items: sessions.map((session, index) =>
        this.toSessionPublic(session, sessions.length - index),
      ),
      total: sessions.length,
      limit: MAX_ACTIVE_SESSIONS_PER_USER,
    };
  }

  async createActiveSession(userId: string) {
    const userObjectId = new Types.ObjectId(userId);
    const total = await this.purchaseRequestSessionModel
      .countDocuments({ userId: userObjectId })
      .exec();

    if (total >= MAX_ACTIVE_SESSIONS_PER_USER) {
      throw new BadRequestException(
        `Ko‘pi bilan ${MAX_ACTIVE_SESSIONS_PER_USER} ta faol seans bo‘lishi mumkin`,
      );
    }

    const payload = {
      userId: userObjectId,
      title: `Ariza ${total + 1}`,
      items: [],
      comment: '',
      purchasePeriodType: PurchasePeriodType.PLAIN,
    };

    try {
      const session = await this.purchaseRequestSessionModel.create(payload);
      return this.toSessionPublic(session, total + 1);
    } catch (error) {
      if (
        error instanceof MongoServerError &&
        error.code === 11000 &&
        String(error.message).includes('userId')
      ) {
        await this.syncPurchaseRequestSessionIndexes();

        const session = await this.purchaseRequestSessionModel.create(payload);
        return this.toSessionPublic(session, total + 1);
      }

      throw error;
    }
  }

  normalizeSessionPayload(body: Record<string, unknown>): SavePurchaseRequestSessionDto {
    const toInt = (value: unknown) => {
      if (value === '' || value == null) return undefined;
      const parsed = Number.parseInt(String(value), 10);
      return Number.isFinite(parsed) ? parsed : undefined;
    };

    const isMongoId = (value: unknown) =>
      typeof value === 'string' && Types.ObjectId.isValid(value);

    const items = Array.isArray(body.items)
      ? body.items.map((raw) => {
          const item = raw as Record<string, unknown>;
          return {
            name: String(item.name ?? '').trim(),
            characteristics: String(item.characteristics ?? '').trim(),
            quantity: toInt(item.quantity) ?? 1,
            unit: String(item.unit ?? '').trim(),
            manufacturingCountry: String(item.manufacturingCountry ?? '').trim(),
          };
        })
      : [];

    const commissionMemberIds = Array.isArray(body.commissionMemberIds)
      ? body.commissionMemberIds.filter(isMongoId).map(String)
      : [];

    const dto: SavePurchaseRequestSessionDto = {
      title: typeof body.title === 'string' ? body.title.trim() : undefined,
      commissionMemberIds,
      items,
      comment: typeof body.comment === 'string' ? body.comment : '',
      commissionAgreementText:
        typeof body.commissionAgreementText === 'string'
          ? body.commissionAgreementText
          : '',
    };

    if (isMongoId(body.bossId)) {
      dto.bossId = String(body.bossId);
    }

    const purchasePeriodType = parsePurchasePeriodType(body.purchasePeriodType);

    if (purchasePeriodType) {
      dto.purchasePeriodType = purchasePeriodType;

      if (purchasePeriodType === PurchasePeriodType.PLAIN) {
        dto.purchasePeriodYear = undefined;
        dto.purchasePeriodQuarter = undefined;
        dto.purchasePeriodMonth = undefined;
      } else {
        dto.purchasePeriodYear = toInt(body.purchasePeriodYear);

        if (purchasePeriodType === PurchasePeriodType.QUARTER) {
          dto.purchasePeriodQuarter = toInt(body.purchasePeriodQuarter);
        }

        if (purchasePeriodType === PurchasePeriodType.MONTH) {
          dto.purchasePeriodMonth = toInt(body.purchasePeriodMonth);
        }
      }
    }

    return dto;
  }

  normalizeUpdatePayload(body: Record<string, unknown>): UpdatePurchaseRequestDto {
    const sessionDto = this.normalizeSessionPayload(body);

    if (!sessionDto.bossId) {
      throw new BadRequestException('Boshliqni tanlang');
    }

    if (!sessionDto.commissionMemberIds?.length) {
      throw new BadRequestException('Kamida bitta komissiya a’zosini tanlang');
    }

    const purchasePeriodType = resolvePurchasePeriodType(
      sessionDto.purchasePeriodType,
    );

    if (
      purchasePeriodType !== PurchasePeriodType.PLAIN &&
      !sessionDto.purchasePeriodYear
    ) {
      throw new BadRequestException('Sotib olish yilini tanlang');
    }

    const dto: UpdatePurchaseRequestDto = {
      commissionMemberIds: sessionDto.commissionMemberIds,
      bossId: sessionDto.bossId,
      items: (sessionDto.items ?? []).map((item) => ({
        name: item.name?.trim() || '—',
        characteristics: item.characteristics?.trim() || '—',
        quantity: item.quantity ?? 1,
        unit: item.unit?.trim() || '—',
        manufacturingCountry: item.manufacturingCountry?.trim() || '—',
      })),
      comment: sessionDto.comment ?? '',
      commissionAgreementText: sessionDto.commissionAgreementText ?? '',
      purchasePeriodType,
      purchasePeriodYear: sessionDto.purchasePeriodYear,
      purchasePeriodQuarter: sessionDto.purchasePeriodQuarter,
      purchasePeriodMonth: sessionDto.purchasePeriodMonth,
    };

    validatePurchasePeriod(dto);

    return dto;
  }

  normalizeResubmitPayload(body: Record<string, unknown>): ResubmitPurchaseRequestDto {
    const sessionDto = this.normalizeSessionPayload(body);
    const resubmitTarget = body.resubmitTarget === 'boss' ? 'boss' : 'commission';
    const resubmitToMemberIds = (
      Array.isArray(body.resubmitToMemberIds) ? body.resubmitToMemberIds : []
    )
      .map((value) => String(value))
      .filter((value) => /^[a-f\d]{24}$/i.test(value));

    if (resubmitTarget !== 'boss' && !resubmitToMemberIds.length) {
      throw new BadRequestException(
        'Qayta kelishish uchun kamida bitta rad etgan a’zoni tanlang',
      );
    }

    const items = sessionDto.items ?? [];

    if (!items.length) {
      throw new BadRequestException('Kamida bitta tovar kiriting');
    }

    const purchasePeriodType = resolvePurchasePeriodType(
      sessionDto.purchasePeriodType,
    );

    const dto: ResubmitPurchaseRequestDto = {
      items: items.map((item) => ({
        name: item.name?.trim() || '—',
        characteristics: item.characteristics?.trim() || '—',
        quantity: item.quantity ?? 1,
        unit: item.unit?.trim() || '—',
        manufacturingCountry: item.manufacturingCountry?.trim() || '—',
      })),
      comment: sessionDto.comment ?? '',
      commissionAgreementText: sessionDto.commissionAgreementText ?? '',
      purchasePeriodType,
      purchasePeriodYear: sessionDto.purchasePeriodYear,
      purchasePeriodQuarter: sessionDto.purchasePeriodQuarter,
      purchasePeriodMonth: sessionDto.purchasePeriodMonth,
      resubmitTarget,
      resubmitToMemberIds:
        resubmitTarget === 'boss' ? undefined : resubmitToMemberIds,
      ...(sessionDto.commissionMemberIds?.length
        ? { commissionMemberIds: sessionDto.commissionMemberIds }
        : {}),
      ...(sessionDto.bossId ? { bossId: sessionDto.bossId } : {}),
    };

    validatePurchasePeriod(dto);

    return dto;
  }

  async saveActiveSession(
    userId: string,
    sessionId: string,
    dto: SavePurchaseRequestSessionDto,
  ) {
    const session = await this.findActiveSessionOrFail(userId, sessionId);

    const items = (dto.items ?? []).map((item) => ({
      name: item.name?.trim() ?? '',
      characteristics: item.characteristics?.trim() ?? '',
      quantity:
        item.quantity && Number.isFinite(item.quantity) && item.quantity >= 1
          ? item.quantity
          : 1,
      unit: item.unit?.trim() ?? '',
      manufacturingCountry: item.manufacturingCountry?.trim() ?? '',
    }));

    session.commissionMemberIds = (dto.commissionMemberIds ?? []).map(
      (id) => new Types.ObjectId(id),
    );
    session.bossId = dto.bossId ? new Types.ObjectId(dto.bossId) : undefined;
    session.items = items;
    session.comment = dto.comment?.trim() ?? '';
    session.commissionAgreementText = dto.commissionAgreementText?.trim() ?? '';

    if (dto.title?.trim()) {
      session.title = dto.title.trim();
    } else {
      const autoTitle = items.find((item) => item.name)?.name;
      if (autoTitle) {
        session.title = autoTitle;
      }
    }

    if (dto.purchasePeriodType) {
      session.purchasePeriodType = dto.purchasePeriodType;

      if (dto.purchasePeriodType === PurchasePeriodType.PLAIN) {
        session.purchasePeriodYear = undefined;
        session.purchasePeriodQuarter = undefined;
        session.purchasePeriodMonth = undefined;
      } else {
        session.purchasePeriodYear = dto.purchasePeriodYear;
        session.purchasePeriodQuarter =
          dto.purchasePeriodType === PurchasePeriodType.QUARTER
            ? dto.purchasePeriodQuarter
            : undefined;
        session.purchasePeriodMonth =
          dto.purchasePeriodType === PurchasePeriodType.MONTH
            ? dto.purchasePeriodMonth
            : undefined;
      }
    } else if (!session.purchasePeriodType) {
      session.purchasePeriodType = PurchasePeriodType.PLAIN;
      session.purchasePeriodYear = undefined;
      session.purchasePeriodQuarter = undefined;
      session.purchasePeriodMonth = undefined;
    }

    session.markModified('items');
    session.markModified('commissionMemberIds');
    await session.save();

    return this.toSessionPublic(session);
  }

  async downloadSessionDocument(
    userId: string,
    sessionId: string,
    docType: 'bildirgi' | 'kelishuv',
  ) {
    await this.findActiveSessionOrFail(userId, sessionId);
    const buffer = await this.sessionDocumentsService.readDocument(
      sessionId,
      docType,
    );

    return {
      buffer,
      filename: `${docType}.docx`,
    };
  }

  async uploadSessionDocument(
    userId: string,
    sessionId: string,
    docType: 'bildirgi' | 'kelishuv',
    file: Express.Multer.File,
  ) {
    await this.findActiveSessionOrFail(userId, sessionId);

    if (!file?.buffer?.length) {
      throw new BadRequestException('Word fayl tanlanmadi');
    }

    const originalName = file.originalname?.toLowerCase() ?? '';
    if (!originalName.endsWith('.docx')) {
      throw new BadRequestException('Faqat .docx formatidagi fayl qabul qilinadi');
    }

    await this.sessionDocumentsService.saveDocument(
      sessionId,
      docType,
      file.buffer,
    );

    await this.bumpSessionDocumentVersion(sessionId, docType);

    return {
      docType,
      size: file.buffer.length,
      uploaded: true,
    };
  }

  private shouldSyncSessionBeforePrepare(dto?: SavePurchaseRequestSessionDto) {
    if (!dto) return false;

    return Boolean(
      dto.bossId ||
        dto.commissionMemberIds?.length ||
        dto.items?.length ||
        dto.comment?.trim() ||
        dto.commissionAgreementText?.trim() ||
        dto.purchasePeriodType,
    );
  }

  async prepareSessionDocuments(
    userId: string,
    sessionId: string,
    dto?: SavePurchaseRequestSessionDto,
    options?: { regenerateKelishuvOnly?: boolean },
  ) {
    if (this.shouldSyncSessionBeforePrepare(dto)) {
      await this.saveActiveSession(userId, sessionId, dto!);
    }

    const session = await this.findActiveSessionOrFail(userId, sessionId);

    if (!session.commissionMemberIds?.length || !session.bossId) {
      throw new BadRequestException(
        'Hujjat tayyorlash uchun komissiya va boshliq tanlangan bo‘lishi kerak',
      );
    }

    const requestCode = await this.ensureSessionRequestCode(session, userId);

    if (!session.documentToken) {
      session.documentToken = this.sessionDocumentsService.createDocumentToken();
    }

    if (!session.applicantVerificationToken) {
      session.applicantVerificationToken =
        this.sessionDocumentsService.createApplicantVerificationToken();
    }

    if (options?.regenerateKelishuvOnly) {
      await this.sessionDocumentsService.writeKelishuvDocument(
        session,
        userId,
        sessionId,
        requestCode,
        session.applicantVerificationToken,
      );
    } else {
      await this.sessionDocumentsService.prepareSessionDocuments(
        session,
        userId,
        sessionId,
        session.applicantVerificationToken,
        requestCode,
      );
    }

    const version = Date.now();
    session.documentsPreparedAt = new Date();
    session.documentVersions = {
      bildirgi: version,
      kelishuv: version,
    };
    await session.save();

    return {
      sessionId,
      requestCode,
      documentToken: session.documentToken,
      documentsPreparedAt: session.documentsPreparedAt,
      documentVersions: session.documentVersions,
    };
  }

  async assertSessionDocumentAccess(sessionId: string, token: string) {
    const session = await this.purchaseRequestSessionModel
      .findById(sessionId)
      .exec();

    if (!session?.documentToken || session.documentToken !== token) {
      throw new UnauthorizedException('Hujjatga kirish rad etildi');
    }
  }

  async getSessionOnlyOfficeMeta(userId: string, sessionId: string) {
    const session = await this.findActiveSessionOrFail(userId, sessionId);

    if (!session.documentToken || !session.documentsPreparedAt) {
      throw new BadRequestException(
        'Hujjatlar tayyor emas — avval tayyorlash tugmasini bosing',
      );
    }

    return {
      documentToken: session.documentToken,
      documentVersions: session.documentVersions ?? {},
    };
  }

  async getSessionDocumentVersion(
    sessionId: string,
    docType: 'bildirgi' | 'kelishuv',
  ) {
    const session = await this.purchaseRequestSessionModel
      .findById(sessionId)
      .exec();

    return session?.documentVersions?.[docType] ?? Date.now();
  }

  async bumpSessionDocumentVersion(
    sessionId: string,
    docType: 'bildirgi' | 'kelishuv',
  ) {
    const session = await this.purchaseRequestSessionModel
      .findById(sessionId)
      .exec();

    if (!session) {
      throw new NotFoundException('Faol seans topilmadi');
    }

    const nextVersion = Date.now();
    session.documentVersions = {
      ...(session.documentVersions ?? {}),
      [docType]: nextVersion,
    };
    await session.save();

    return nextVersion;
  }

  async verifyApplicantByToken(token: string) {
    const request = await this.purchaseRequestModel
      .findOne({ applicantVerificationToken: token })
      .exec();

    if (request) {
      return {
        verified: true,
        status: 'submitted',
        requestId: String(request._id),
        requestCode: request.requestCode,
        applicantName: request.applicant.displayName,
        submittedAt: request.createdAt,
      };
    }

    const session = await this.purchaseRequestSessionModel
      .findOne({ applicantVerificationToken: token })
      .exec();

    if (session) {
      return {
        verified: true,
        status: 'draft',
        sessionId: String(session._id),
        title: session.title,
        updatedAt: session.updatedAt,
      };
    }

    throw new NotFoundException('Tekshiruv tokeni topilmadi');
  }

  private assertSubmittedDocxUpload(file: Express.Multer.File | undefined) {
    if (!file?.buffer?.length) {
      return;
    }

    const originalName = file.originalname?.toLowerCase() ?? '';
    if (!originalName.endsWith('.docx')) {
      throw new BadRequestException('Faqat .docx formatidagi fayl qabul qilinadi');
    }
  }

  private async resolveSessionSubmitDocuments(
    sessionId: string,
    files?: {
      bildirgi?: Express.Multer.File;
      kelishuv?: Express.Multer.File;
    },
  ) {
    if (files?.bildirgi?.buffer?.length && files?.kelishuv?.buffer?.length) {
      this.assertSubmittedDocxUpload(files.bildirgi);
      this.assertSubmittedDocxUpload(files.kelishuv);

      return {
        bildirgi: files.bildirgi.buffer,
        kelishuv: files.kelishuv.buffer,
      };
    }

    await this.sessionDocumentsService.assertDocumentsReady(sessionId);

    return {
      bildirgi: await this.sessionDocumentsService.readDocument(
        sessionId,
        'bildirgi',
      ),
      kelishuv: await this.sessionDocumentsService.readDocument(
        sessionId,
        'kelishuv',
      ),
    };
  }

  async submitActiveSession(
    userId: string,
    sessionId: string,
    files?: {
      bildirgi?: Express.Multer.File;
      kelishuv?: Express.Multer.File;
    },
    sessionPayloadJson?: string,
  ) {
    await this.findActiveSessionOrFail(userId, sessionId);

    if (sessionPayloadJson?.trim()) {
      try {
        const parsed = JSON.parse(sessionPayloadJson) as Record<string, unknown>;
        await this.saveActiveSession(
          userId,
          sessionId,
          this.normalizeSessionPayload(parsed),
        );
      } catch (error) {
        if (error instanceof BadRequestException) {
          throw error;
        }

        throw new BadRequestException('Ariza ma’lumotlari noto‘g‘ri formatda yuborildi');
      }
    }

    const session = await this.findActiveSessionOrFail(userId, sessionId);

    if (session.editingRequestId) {
      throw new BadRequestException(
        'Tahrirlash seansini «Saqlash» tugmasi orqali yangilang',
      );
    }

    if (!session.purchasePeriodType) {
      session.purchasePeriodType = PurchasePeriodType.PLAIN;
      await session.save();
    }

    if (!this.sessionHasContent(session)) {
      throw new BadRequestException('Faol seans bo‘sh — avval ma’lumot kiriting');
    }

    if (!session.commissionMemberIds?.length) {
      throw new BadRequestException('Kamida bitta komissiya a’zosini tanlang');
    }

    if (!session.bossId) {
      throw new BadRequestException('Boshliqni tanlang');
    }

    const normalizedItems = (session.items ?? [])
      .map((item) => ({
        name: item.name?.trim() ?? '',
        characteristics: item.characteristics?.trim() ?? '',
        quantity: item.quantity ?? 1,
        unit: item.unit?.trim() ?? '',
        manufacturingCountry: item.manufacturingCountry?.trim() ?? '',
      }))
      .filter((item) => item.name || item.characteristics);

    if (!normalizedItems.length) {
      throw new BadRequestException('Kamida bitta tovar kiriting');
    }

    if (normalizedItems.some((item) => !item.name)) {
      throw new BadRequestException('Har bir tovar uchun nom kiriting');
    }

    if (normalizedItems.some((item) => !item.characteristics)) {
      throw new BadRequestException('Har bir tovar uchun xususiyat kiriting');
    }

    if (
      normalizedItems.some(
        (item) => !Number.isFinite(item.quantity) || item.quantity < 1,
      )
    ) {
      throw new BadRequestException('Tovar soni kamida 1 bo‘lishi kerak');
    }

    if (normalizedItems.some((item) => !item.unit)) {
      throw new BadRequestException('Har bir tovar uchun birlikni tanlang');
    }

    if (normalizedItems.some((item) => !item.manufacturingCountry)) {
      throw new BadRequestException(
        'Har bir tovar uchun ishlab chiqarilgan davlatni tanlang',
      );
    }

    const purchasePeriodType = resolvePurchasePeriodType(
      session.purchasePeriodType,
    );

    const createDto: CreatePurchaseRequestDto = {
      commissionMemberIds: session.commissionMemberIds.map(String),
      bossId: String(session.bossId),
      items: normalizedItems,
      comment: session.comment?.trim() ?? '',
      commissionAgreementText: session.commissionAgreementText?.trim() ?? '',
      purchasePeriodType,
      purchasePeriodYear:
        purchasePeriodType === PurchasePeriodType.PLAIN
          ? undefined
          : session.purchasePeriodYear,
      purchasePeriodQuarter: session.purchasePeriodQuarter,
      purchasePeriodMonth: session.purchasePeriodMonth,
    };

    validatePurchasePeriod(createDto);

    if (!files?.bildirgi?.buffer?.length || !files?.kelishuv?.buffer?.length) {
      throw new BadRequestException(
        'Bildirgi va kelishuv Word fayllari yuborilishi shart',
      );
    }

    const documentBuffers = await this.resolveSessionSubmitDocuments(
      sessionId,
      files,
    );

    const reservedRequestCode = await this.ensureSessionRequestCode(
      session,
      userId,
    );

    const existingRequest = await this.findRequestCreatedFromSession(
      session,
      userId,
      reservedRequestCode,
    );

    if (existingRequest) {
      if (!existingRequest.submittedBildirgi || !existingRequest.submittedKelishuv) {
        const submittedDocuments =
          await this.sessionDocumentsService.saveSubmittedDocumentsToRequest(
            String(existingRequest._id),
            existingRequest.requestCode,
            documentBuffers,
          );

        existingRequest.submittedBildirgi = submittedDocuments.bildirgi;
        existingRequest.submittedKelishuv = submittedDocuments.kelishuv;

        if (
          !existingRequest.applicantVerificationToken &&
          session.applicantVerificationToken
        ) {
          existingRequest.applicantVerificationToken =
            session.applicantVerificationToken;
        }

        await existingRequest.save();
        this.emitPurchaseRequestChanged(existingRequest, 'created');
      }

      await this.purchaseRequestSessionModel.findByIdAndDelete(session.id).exec();

      return this.toPublic(existingRequest, userId);
    }

    const request = await this.createPurchaseRequestRecord(createDto, userId, {
      requestCode: reservedRequestCode,
    });
    const submittedDocuments =
      await this.sessionDocumentsService.saveSubmittedDocumentsToRequest(
        String(request._id),
        request.requestCode,
        documentBuffers,
      );

    request.submittedBildirgi = submittedDocuments.bildirgi;
    request.submittedKelishuv = submittedDocuments.kelishuv;
    request.applicantVerificationToken = session.applicantVerificationToken;
    await request.save();

    this.emitPurchaseRequestChanged(request, 'created');

    await this.purchaseRequestSessionModel.findByIdAndDelete(session.id).exec();

    return this.toPublic(request, userId);
  }

  async deleteActiveSession(userId: string, sessionId: string) {
    const result = await this.purchaseRequestSessionModel
      .deleteOne({
        _id: new Types.ObjectId(sessionId),
        userId: new Types.ObjectId(userId),
      })
      .exec();

    if (!result.deletedCount) {
      throw new NotFoundException('Faol seans topilmadi');
    }

    return { id: sessionId, deleted: true };
  }
}
