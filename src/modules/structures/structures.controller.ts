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
import { CreateStructureDto } from './dto/create-structure.dto';
import { QueryStructuresDto } from './dto/query-structures.dto';
import { UpdateStructureDto } from './dto/update-structure.dto';
import { StructuresService } from './structures.service';

@Controller('structures')
@UseGuards(JwtAuthGuard)
export class StructuresController {
  constructor(private readonly structuresService: StructuresService) {}

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
  create(@Body() dto: CreateStructureDto) {
    return this.structuresService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateStructureDto) {
    return this.structuresService.update(id, dto);
  }

  @Delete(':id')
  deactivate(@Param('id') id: string) {
    return this.structuresService.deactivate(id);
  }
}
