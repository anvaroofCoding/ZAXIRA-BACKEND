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
import { ParseMongoIdPipe } from '../../common/pipes/parse-mongo-id.pipe';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { UsersService } from '../users/users.service';
import { CommissionsService } from './commissions.service';
import { COMMISSIONS_PAGE_PATH } from './constants/commissions-page-path';
import { CreateCommissionDto } from './dto/create-commission.dto';
import { QueryCommissionsDto } from './dto/query-commissions.dto';
import { UpdateCommissionDto } from './dto/update-commission.dto';

@Controller('commissions')
@UseGuards(JwtAuthGuard)
export class CommissionsController {
  constructor(
    private readonly commissionsService: CommissionsService,
    private readonly usersService: UsersService,
  ) {}

  @Get()
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    const query = new QueryCommissionsDto();
    query.page = Math.max(1, Number(page) || 1);
    query.limit = Math.min(100, Math.max(1, Number(limit) || 10));
    query.search = search?.trim() || undefined;

    return this.commissionsService.findAllPaginated(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseMongoIdPipe) id: string) {
    return this.commissionsService.findByIdOrFail(id);
  }

  @Post()
  async create(
    @Body() dto: CreateCommissionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.usersService.assertPageActionPermission(
      user.sub,
      user.role,
      COMMISSIONS_PAGE_PATH,
      'create',
    );
    return this.commissionsService.create(dto);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseMongoIdPipe) id: string,
    @Body() dto: UpdateCommissionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.usersService.assertPageActionPermission(
      user.sub,
      user.role,
      COMMISSIONS_PAGE_PATH,
      'update',
    );
    return this.commissionsService.update(id, dto);
  }

  @Delete(':id')
  async deactivate(
    @Param('id', ParseMongoIdPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.usersService.assertPageActionPermission(
      user.sub,
      user.role,
      COMMISSIONS_PAGE_PATH,
      'delete',
    );
    return this.commissionsService.deactivate(id);
  }
}
