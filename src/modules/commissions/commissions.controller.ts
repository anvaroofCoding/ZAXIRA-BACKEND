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
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ParseMongoIdPipe } from '../../common/pipes/parse-mongo-id.pipe';
import { CommissionsService } from './commissions.service';
import { CreateCommissionDto } from './dto/create-commission.dto';
import { QueryCommissionsDto } from './dto/query-commissions.dto';
import { UpdateCommissionDto } from './dto/update-commission.dto';

@Controller('commissions')
@UseGuards(JwtAuthGuard)
export class CommissionsController {
  constructor(private readonly commissionsService: CommissionsService) {}

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
  create(@Body() dto: CreateCommissionDto) {
    return this.commissionsService.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseMongoIdPipe) id: string,
    @Body() dto: UpdateCommissionDto,
  ) {
    return this.commissionsService.update(id, dto);
  }

  @Delete(':id')
  deactivate(@Param('id', ParseMongoIdPipe) id: string) {
    return this.commissionsService.deactivate(id);
  }
}
