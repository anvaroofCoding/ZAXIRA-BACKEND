import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { UsersService } from '../users/users.service';
import { STRUCTURES_PAGE_PATH } from './constants/structures-page-path';
import { CreateStructureDto } from './dto/create-structure.dto';
import { QueryStructuresDto } from './dto/query-structures.dto';
import { UpdateStructureDto } from './dto/update-structure.dto';
import { StructuresService } from './structures.service';

@Controller('structures')
@UseGuards(JwtAuthGuard)
export class StructuresController {
  constructor(
    private readonly structuresService: StructuresService,
    private readonly usersService: UsersService,
  ) {}

  @Get()
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    if (page !== undefined && page !== '') {
      const query = new QueryStructuresDto();
      query.page = Math.max(1, Number(page) || 1);
      query.limit = Math.min(100, Math.max(1, Number(limit) || 10));
      query.search = search?.trim() || undefined;
      return this.structuresService.findAllPaginated(query);
    }

    return this.structuresService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.structuresService.findByIdOrFail(id);
  }

  @Post()
  async create(
    @Body() dto: CreateStructureDto,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.usersService.assertPageActionPermission(
      user.sub,
      user.role,
      STRUCTURES_PAGE_PATH,
      'create',
    );
    return this.structuresService.create(dto);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateStructureDto,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.usersService.assertPageActionPermission(
      user.sub,
      user.role,
      STRUCTURES_PAGE_PATH,
      'update',
    );
    return this.structuresService.update(id, dto);
  }

  @Delete(':id')
  async deactivate(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.usersService.assertPageActionPermission(
      user.sub,
      user.role,
      STRUCTURES_PAGE_PATH,
      'delete',
    );
    return this.structuresService.deactivate(id);
  }
}
