import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createReadStream } from 'fs';
import { Model, Types } from 'mongoose';
import { randomUUID } from 'crypto';
import * as path from 'path';
import { UserRole } from '../../common/enums/user-role.enum';
import { isSuperAdminRole } from '../../common/utils/super-admin.util';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/enums/notification-type.enum';
import { StructuresService } from '../structures/structures.service';
import { UsersService } from '../users/users.service';
import { UserPermissionsMap } from '../users/types/page-permission.type';
import { hasPageAccess } from '../users/utils/permissions.util';
import { UserSnapshotEmbeddable } from '../purchase-requests/schemas/user-snapshot.schema';
import { TASK_ASSIGNMENT_PAGE_PATH } from './constants/tasks-page-path';
import { CreateAssignedTasksDto } from './dto/create-assigned-tasks.dto';
import { QueryAssignedTasksDto } from './dto/query-assigned-tasks.dto';
import { isCalendarDayOnOrBeforeToday } from '../../common/utils/calendar-day.util';
import { AssignedTaskStatus } from './enums/assigned-task-status.enum';
import {
  AssignedTask,
  AssignedTaskDocument,
} from './schemas/assigned-task.schema';
import { TaskFilesService } from './task-files.service';

@Injectable()
export class TasksService {
  constructor(
    @InjectModel(AssignedTask.name)
    private readonly taskModel: Model<AssignedTaskDocument>,
    private readonly usersService: UsersService,
    private readonly structuresService: StructuresService,
    private readonly taskFilesService: TaskFilesService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private isPrivilegedRole(role?: UserRole) {
    return role === UserRole.ADMIN || role === UserRole.SUPER_ADMIN;
  }

  private resolveTaskFiles(task: Pick<AssignedTask, 'file' | 'files'>) {
    if (task.files?.length) {
      return task.files;
    }

    return task.file ? [task.file] : [];
  }

  private toPublicFiles(task: Pick<AssignedTask, 'file' | 'files'>) {
    return this.resolveTaskFiles(task).map((file) => ({
      storedName: file.storedName,
      originalName: file.originalName,
      mimeType: file.mimeType,
      size: file.size,
      hasFile: true,
    }));
  }

  private toPublic(task: AssignedTaskDocument) {
    const files = this.toPublicFiles(task);

    return {
      id: task.id,
      groupId: task.groupId,
      structure: {
        structureId: String(task.structure.structureId),
        fullName: task.structure.fullName,
        shortName: task.structure.shortName,
      },
      assignee: {
        userId: String(task.assignee.userId),
        displayName: task.assignee.displayName,
        login: task.assignee.login,
        structureShortName: task.assignee.structureShortName ?? null,
        position: task.assignee.position ?? '',
      },
      assignedBy: {
        userId: String(task.assignedBy.userId),
        displayName: task.assignedBy.displayName,
        login: task.assignedBy.login,
      },
      title: task.title,
      description: task.description,
      dueDate: task.dueDate,
      files,
      file: files[0] ?? null,
      status: task.status,
      completedAt: task.completedAt ?? null,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      overdue: this.isTaskOverdue(task),
    };
  }

  private isTaskOverdue(task: Pick<AssignedTask, 'dueDate' | 'status'>) {
    if (
      task.status === AssignedTaskStatus.COMPLETED ||
      task.status === AssignedTaskStatus.CANCELLED
    ) {
      return false;
    }

    return isCalendarDayOnOrBeforeToday(task.dueDate);
  }

  private async assertCanAssignTasks(userId: string, role?: UserRole) {
    if (this.isPrivilegedRole(role) || isSuperAdminRole(role)) {
      return;
    }

    await this.usersService.assertPageActionPermission(
      userId,
      role,
      TASK_ASSIGNMENT_PAGE_PATH,
      'create',
    );
  }

  private async assertCanManageAssignedTask(
    task: AssignedTaskDocument,
    userId: string,
    role?: UserRole,
  ) {
    if (this.isPrivilegedRole(role) || isSuperAdminRole(role)) {
      return;
    }

    if (String(task.assignedBy.userId) === userId) {
      return;
    }

    const user = await this.usersService.findById(userId);
    const resolvedRole = role ?? user?.role;

    if (
      user &&
      (this.isPrivilegedRole(user.role) || isSuperAdminRole(user.role))
    ) {
      return;
    }

    await this.usersService.assertPageActionPermission(
      userId,
      resolvedRole,
      TASK_ASSIGNMENT_PAGE_PATH,
      'update',
      'Vazifani boshqarish uchun ruxsat yo‘q',
    );
  }

  private async assertPageAccess(userId: string, role?: UserRole) {
    if (isSuperAdminRole(role)) {
      return;
    }

    const user = await this.usersService.findByIdOrFail(userId);

    if (!user?.isActive) {
      throw new ForbiddenException('Sahifaga ruxsat yo‘q');
    }

    const permissions = this.usersService.resolvePermissionsForRole(
      user.role,
      user.permissions as UserPermissionsMap | undefined,
    );

    if (!hasPageAccess(permissions, TASK_ASSIGNMENT_PAGE_PATH, false)) {
      throw new ForbiddenException('Sahifaga ruxsat yo‘q');
    }
  }

  private async buildAssigneeSnapshot(
    assigneeId: string,
    structureId: string,
  ): Promise<UserSnapshotEmbeddable> {
    const user = await this.usersService.findByIdOrFail(assigneeId);

    if (!user.isActive) {
      throw new BadRequestException(
        `Nofaol foydalanuvchi tanlangan: ${user.displayName || user.login}`,
      );
    }

    if (String(user.structureId ?? '') !== structureId) {
      throw new BadRequestException(
        `${user.displayName || user.login} tanlangan tuzilmaga biriktirilmagan`,
      );
    }

    const structure =
      await this.usersService.resolveStructureSnapshotForUser(assigneeId);

    return {
      userId: new Types.ObjectId(user.id),
      displayName: user.displayName || user.login,
      login: user.login,
      structureShortName: structure?.shortName,
      structureLeaderName: structure?.leaderName,
      position: user.position?.trim() ?? '',
    };
  }

  private async buildAssignedBySnapshot(userId: string) {
    const user = await this.usersService.findByIdOrFail(userId);
    const structure =
      await this.usersService.resolveStructureSnapshotForUser(userId);

    return {
      userId: new Types.ObjectId(user.id),
      displayName: user.displayName || user.login,
      login: user.login,
      structureShortName: structure?.shortName,
      structureLeaderName: structure?.leaderName,
      position: user.position?.trim() ?? '',
    };
  }

  async createAssignments(
    dto: CreateAssignedTasksDto,
    uploadedFiles: Express.Multer.File[],
    userId: string,
    role?: UserRole,
  ) {
    await this.assertCanAssignTasks(userId, role);

    const structureId = dto.structureId.trim();
    const uniqueAssigneeIds = [...new Set(dto.assigneeIds.map((id) => id.trim()))];

    if (!structureId || !Types.ObjectId.isValid(structureId)) {
      throw new BadRequestException('Tuzilma noto‘g‘ri');
    }

    if (!uniqueAssigneeIds.length) {
      throw new BadRequestException('Kamida bitta foydalanuvchini tanlang');
    }

    if (!dto.title?.trim()) {
      throw new BadRequestException('Vazifa nomini kiriting');
    }

    if (!dto.description?.trim()) {
      throw new BadRequestException('Vazifa mazmunini kiriting');
    }

    if (!dto.dueDate?.trim()) {
      throw new BadRequestException('Bajarilish sanasini kiriting');
    }

    const structureSnapshot =
      await this.structuresService.buildSnapshot(structureId);
    const assignedBy = await this.buildAssignedBySnapshot(userId);
    const dueDate = new Date(dto.dueDate);

    if (Number.isNaN(dueDate.getTime())) {
      throw new BadRequestException('Bajarilish sanasi noto‘g‘ri');
    }

    const groupId = randomUUID();
    const savedFiles = await this.taskFilesService.saveUploadedFiles(
      groupId,
      uploadedFiles,
    );

    const assigneeSnapshots = await Promise.all(
      uniqueAssigneeIds.map((assigneeId) =>
        this.buildAssigneeSnapshot(assigneeId, structureId),
      ),
    );

    const created = await this.taskModel.insertMany(
      assigneeSnapshots.map((assignee) => ({
        groupId,
        structure: {
          structureId: new Types.ObjectId(structureSnapshot.structureId),
          fullName: structureSnapshot.fullName,
          shortName: structureSnapshot.shortName,
          leaderName: structureSnapshot.leaderName ?? '',
          capturedAt: structureSnapshot.capturedAt,
        },
        assignee,
        assignedBy,
        title: dto.title.trim(),
        description: dto.description.trim(),
        dueDate,
        files: savedFiles,
        file: savedFiles[0],
        status: AssignedTaskStatus.PENDING,
      })),
    );

    await this.notificationsService.createMany(
      created.map((task) => ({
        userId: String(task.assignee.userId),
        type: NotificationType.TASK_ASSIGNED,
        title: 'Yangi vazifa',
        message: `${task.title} — bajarish muddati: ${this.formatDueDate(task.dueDate)}`,
        linkPath: '/dashboard/kalendar',
        entityId: String(task._id),
      })),
    );

    return {
      groupId,
      count: created.length,
      items: created.map((task) => this.toPublic(task as AssignedTaskDocument)),
    };
  }

  private formatDueDate(value: Date) {
    return new Intl.DateTimeFormat('uz-UZ', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(value));
  }

  async findAssignedByAdmin(
    query: QueryAssignedTasksDto,
    userId: string,
    role?: UserRole,
  ) {
    await this.assertPageAccess(userId, role);

    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;
    const search = query.search?.trim();

    const filter: Record<string, unknown> = {};

    if (!isSuperAdminRole(role)) {
      filter['assignedBy.userId'] = new Types.ObjectId(userId);
    }

    if (query.structureId && Types.ObjectId.isValid(query.structureId)) {
      filter['structure.structureId'] = new Types.ObjectId(query.structureId);
    }

    if (query.status) {
      filter.status = query.status;
    }

    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { 'assignee.displayName': { $regex: search, $options: 'i' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.taskModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.taskModel.countDocuments(filter).exec(),
    ]);

    return {
      items: items.map((item) => this.toPublic(item)),
      total,
      page,
      limit,
    };
  }

  async findStructureUsersForAssignment(
    structureId: string,
    userId: string,
    role?: UserRole,
  ) {
    await this.assertCanAssignTasks(userId, role);

    if (!Types.ObjectId.isValid(structureId)) {
      throw new BadRequestException('Tuzilma noto‘g‘ri');
    }

    return this.usersService.findActiveUsersByStructureId(structureId);
  }

  async findMyPendingTasks(userId: string) {
    const assigneeObjectId = new Types.ObjectId(userId);
    const items = await this.taskModel
      .find({
        'assignee.userId': assigneeObjectId,
        status: AssignedTaskStatus.PENDING,
      })
      .sort({ dueDate: 1, createdAt: -1 })
      .exec();

    return items.map((item) => this.toPublic(item));
  }

  async findMyTasksInRange(userId: string, from: Date, to: Date) {
    const items = await this.taskModel
      .find({
        'assignee.userId': new Types.ObjectId(userId),
        dueDate: { $gte: from, $lte: to },
      })
      .sort({ dueDate: 1 })
      .exec();

    return items.map((item) => this.toPublic(item));
  }

  async completeTask(taskId: string, userId: string, role?: UserRole) {
    const task = await this.taskModel.findById(taskId).exec();

    if (!task) {
      throw new NotFoundException('Vazifa topilmadi');
    }

    await this.assertCanManageAssignedTask(task, userId, role);

    if (task.status === AssignedTaskStatus.COMPLETED) {
      return this.toPublic(task);
    }

    task.status = AssignedTaskStatus.COMPLETED;
    task.completedAt = new Date();
    await task.save();

    return this.toPublic(task);
  }

  async cancelTask(taskId: string, userId: string, role?: UserRole) {
    const task = await this.taskModel.findById(taskId).exec();

    if (!task) {
      throw new NotFoundException('Vazifa topilmadi');
    }

    await this.assertCanManageAssignedTask(task, userId, role);

    if (task.status === AssignedTaskStatus.CANCELLED) {
      return this.toPublic(task);
    }

    if (task.status === AssignedTaskStatus.COMPLETED) {
      throw new BadRequestException('Bajarilgan vazifani bekor qilib bo‘lmaydi');
    }

    task.status = AssignedTaskStatus.CANCELLED;
    task.completedAt = undefined;
    await task.save();

    return this.toPublic(task);
  }

  async getTaskFile(
    taskId: string,
    userId: string,
    role?: UserRole,
    storedName?: string,
  ) {
    const task = await this.taskModel.findById(taskId).exec();
    const files = task ? this.resolveTaskFiles(task) : [];

    if (!task || !files.length) {
      throw new NotFoundException('Fayl topilmadi');
    }

    const isAssignee = String(task.assignee.userId) === userId;
    const isAssigner = String(task.assignedBy.userId) === userId;
    const isAdmin = this.isPrivilegedRole(role) || isSuperAdminRole(role);

    if (!isAssignee && !isAssigner && !isAdmin) {
      throw new ForbiddenException('Faylni yuklab olishga ruxsat yo‘q');
    }

    const file = storedName
      ? files.find((item) => item.storedName === path.basename(storedName))
      : files[0];

    if (!file) {
      throw new NotFoundException('Fayl topilmadi');
    }

    const filePath = this.taskFilesService.resolveStoredPath(
      task.groupId,
      file.storedName,
    );

    return new StreamableFile(createReadStream(filePath), {
      type: file.mimeType,
      disposition: `attachment; filename="${encodeURIComponent(file.originalName)}"`,
    });
  }
}
