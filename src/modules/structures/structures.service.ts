import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { StructureSnapshot } from '../../common/types/structure-snapshot.interface';
import { CreateStructureDto } from './dto/create-structure.dto';
import { QueryStructuresDto } from './dto/query-structures.dto';
import { UpdateStructureDto } from './dto/update-structure.dto';
import { Structure, StructureDocument } from './schemas/structure.schema';

@Injectable()
export class StructuresService {
  constructor(
    @InjectModel(Structure.name)
    private readonly structureModel: Model<StructureDocument>,
  ) {}

  private normalizeShortName(value: string) {
    return value.trim().toUpperCase();
  }

  private toPublic(structure: StructureDocument) {
    return {
      id: structure.id,
      fullName: structure.fullName,
      shortName: structure.shortName,
      isActive: structure.isActive,
      createdAt: structure.createdAt,
      updatedAt: structure.updatedAt,
    };
  }

  async findAll() {
    const items = await this.structureModel
      .find()
      .sort({ fullName: 1 })
      .exec();

    return items.map((item) => this.toPublic(item));
  }

  private buildListFilter(query: QueryStructuresDto): Record<string, unknown> {
    const filter: Record<string, unknown> = {};
    const term = query.search?.trim();

    if (term) {
      const regex = new RegExp(
        term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        'i',
      );
      filter.$or = [{ fullName: regex }, { shortName: regex }];
    }

    return filter;
  }

  async findAllPaginated(query: QueryStructuresDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const filter = this.buildListFilter(query);
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.structureModel
        .find(filter)
        .sort({ fullName: 1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.structureModel.countDocuments(filter).exec(),
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
    const structure = await this.structureModel.findById(id).exec();

    if (!structure) {
      throw new NotFoundException('Tuzilma topilmadi');
    }

    return this.toPublic(structure);
  }

  async buildSnapshot(structureId: string): Promise<StructureSnapshot> {
    const structure = await this.structureModel.findById(structureId).exec();

    if (!structure) {
      throw new NotFoundException('Tuzilma topilmadi');
    }

    return {
      structureId: structure.id,
      fullName: structure.fullName,
      shortName: structure.shortName,
      capturedAt: new Date(),
    };
  }

  private async ensureUniqueShortName(shortName: string, excludeId?: string) {
    const normalized = this.normalizeShortName(shortName);
    const filter: Record<string, unknown> = { shortName: normalized };

    if (excludeId) {
      filter._id = { $ne: excludeId };
    }

    const existing = await this.structureModel.findOne(filter).exec();

    if (existing) {
      throw new ConflictException('Bu qisqa nom band');
    }

    return normalized;
  }

  async create(dto: CreateStructureDto) {
    const shortName = await this.ensureUniqueShortName(dto.shortName);

    const structure = await this.structureModel.create({
      fullName: dto.fullName.trim(),
      shortName,
      isActive: true,
    });

    return this.toPublic(structure);
  }

  async update(id: string, dto: UpdateStructureDto) {
    const structure = await this.structureModel.findById(id).exec();

    if (!structure) {
      throw new NotFoundException('Tuzilma topilmadi');
    }

    if (dto.fullName !== undefined) {
      structure.fullName = dto.fullName.trim();
    }

    if (dto.shortName !== undefined) {
      structure.shortName = await this.ensureUniqueShortName(dto.shortName, id);
    }

    if (dto.isActive !== undefined) {
      structure.isActive = dto.isActive;
    }

    await structure.save();

    return this.toPublic(structure);
  }

  async deactivate(id: string) {
    const structure = await this.structureModel.findById(id).exec();

    if (!structure) {
      throw new NotFoundException('Tuzilma topilmadi');
    }

    structure.isActive = false;
    await structure.save();

    return { success: true };
  }
}
