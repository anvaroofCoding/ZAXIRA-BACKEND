import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { UserSnapshotEmbeddable } from '../purchase-requests/schemas/user-snapshot.schema';
import { UsersService } from '../users/users.service';
import { CreateCommissionDto } from './dto/create-commission.dto';
import { QueryCommissionsDto } from './dto/query-commissions.dto';
import { UpdateCommissionDto } from './dto/update-commission.dto';
import { Commission, CommissionDocument } from './schemas/commission.schema';

@Injectable()
export class CommissionsService {
  constructor(
    @InjectModel(Commission.name)
    private readonly commissionModel: Model<CommissionDocument>,
    private readonly usersService: UsersService,
  ) {}

  private toPublicMember(member: UserSnapshotEmbeddable) {
    return {
      userId: String(member.userId),
      displayName: member.displayName,
      login: member.login,
      structureShortName: member.structureShortName ?? null,
    };
  }

  private toPublicBoss(boss?: UserSnapshotEmbeddable) {
    if (!boss) {
      return null;
    }

    return this.toPublicMember(boss);
  }

  private toPublic(commission: CommissionDocument) {
    return {
      id: commission.id,
      name: commission.name,
      members: commission.members.map((member) => this.toPublicMember(member)),
      boss: this.toPublicBoss(commission.boss),
      memberCount: commission.members.length,
      isActive: commission.isActive,
      createdAt: commission.createdAt,
      updatedAt: commission.updatedAt,
    };
  }

  private assertBossNotInMembers(memberIds: string[], bossId: string) {
    if (memberIds.includes(bossId)) {
      throw new BadRequestException(
        'Boshliq komissiya a’zolari ro‘yxatida bo‘lmasligi kerak',
      );
    }
  }

  private async buildBossSnapshot(bossId: string) {
    const [boss] = await this.buildMemberSnapshots([bossId]);
    return boss;
  }

  private async buildMemberSnapshots(memberIds: string[]) {
    const uniqueIds = [...new Set(memberIds)];

    if (uniqueIds.length !== memberIds.length) {
      throw new BadRequestException('Takroriy a’zolar tanlangan');
    }

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
        position: user.position?.trim() ?? '',
      });
    }

    return snapshots;
  }

  private async ensureUniqueName(name: string, excludeId?: string) {
    const normalized = name.trim();
    const filter: Record<string, unknown> = { name: normalized };

    if (excludeId) {
      filter._id = { $ne: excludeId };
    }

    const existing = await this.commissionModel.findOne(filter).exec();

    if (existing) {
      throw new ConflictException('Bu komissiya nomi band');
    }

    return normalized;
  }

  private buildListFilter(query: QueryCommissionsDto): Record<string, unknown> {
    const filter: Record<string, unknown> = {};
    const term = query.search?.trim();

    if (term) {
      const regex = new RegExp(
        term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        'i',
      );
      filter.$or = [
        { name: regex },
        { 'members.displayName': regex },
        { 'members.login': regex },
        { 'boss.displayName': regex },
        { 'boss.login': regex },
      ];
    }

    return filter;
  }

  async findAllPaginated(query: QueryCommissionsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const filter = this.buildListFilter(query);
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.commissionModel
        .find(filter)
        .sort({ name: 1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.commissionModel.countDocuments(filter).exec(),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
      items: items.map((item) => this.toPublic(item)),
      total,
      page,
      limit,
      totalPages,
    };
  }

  async findByIdOrFail(id: string) {
    const commission = await this.commissionModel.findById(id).exec();

    if (!commission) {
      throw new NotFoundException('Komissiya topilmadi');
    }

    return this.toPublic(commission);
  }

  async create(dto: CreateCommissionDto) {
    const name = await this.ensureUniqueName(dto.name);
    this.assertBossNotInMembers(dto.memberIds, dto.bossId);

    const members = await this.buildMemberSnapshots(dto.memberIds);
    const boss = await this.buildBossSnapshot(dto.bossId);

    const commission = await this.commissionModel.create({
      name,
      members,
      boss,
      isActive: true,
    });

    return this.toPublic(commission);
  }

  async update(id: string, dto: UpdateCommissionDto) {
    const commission = await this.commissionModel.findById(id).exec();

    if (!commission) {
      throw new NotFoundException('Komissiya topilmadi');
    }

    if (dto.name !== undefined) {
      commission.name = await this.ensureUniqueName(dto.name, id);
    }

    const nextMemberIds =
      dto.memberIds ?? commission.members.map((member) => String(member.userId));
    const nextBossId =
      dto.bossId ??
      (commission.boss ? String(commission.boss.userId) : undefined);

    if (nextBossId) {
      this.assertBossNotInMembers(nextMemberIds, nextBossId);
    }

    if (dto.memberIds !== undefined) {
      commission.members = await this.buildMemberSnapshots(dto.memberIds);
    }

    if (dto.bossId !== undefined) {
      commission.boss = await this.buildBossSnapshot(dto.bossId);
    }

    if (dto.isActive !== undefined) {
      commission.isActive = dto.isActive;
    }

    await commission.save();

    return this.toPublic(commission);
  }

  async deactivate(id: string) {
    const commission = await this.commissionModel.findById(id).exec();

    if (!commission) {
      throw new NotFoundException('Komissiya topilmadi');
    }

    commission.isActive = false;
    await commission.save();

    return { success: true };
  }
}
