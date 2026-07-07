import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Request, Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ParseMongoIdPipe } from '../../common/pipes/parse-mongo-id.pipe';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CreateAssignedTasksDto } from './dto/create-assigned-tasks.dto';
import { QueryAssignedTasksDto } from './dto/query-assigned-tasks.dto';
import { TasksService } from './tasks.service';

@Controller('tasks')
@UseGuards(JwtAuthGuard)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  createAssignments(
    @Req() req: Request,
    @Body('structureId') structureId: string | undefined,
    @Body('assigneeIds') assigneeIdsRaw: string | undefined,
    @Body('title') title: string | undefined,
    @Body('description') description: string | undefined,
    @Body('dueDate') dueDate: string | undefined,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    const body = (req.body ?? {}) as Record<string, string | undefined>;
    const assigneeIdsValue = assigneeIdsRaw ?? body.assigneeIds;

    let assigneeIds: string[] = [];
    try {
      const parsed =
        typeof assigneeIdsValue === 'string'
          ? JSON.parse(assigneeIdsValue)
          : assigneeIdsValue;
      assigneeIds = Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      throw new BadRequestException('Foydalanuvchilar ro‘yxati noto‘g‘ri');
    }

    const dto: CreateAssignedTasksDto = {
      structureId: (structureId ?? body.structureId ?? '').trim(),
      assigneeIds,
      title: (title ?? body.title ?? '').trim(),
      description: (description ?? body.description ?? '').trim(),
      dueDate: (dueDate ?? body.dueDate ?? '').trim(),
    };

    return this.tasksService.createAssignments(
      dto,
      files ?? [],
      user.sub,
      user.role,
    );
  }

  @Get('structure-users')
  findStructureUsers(
    @Query('structureId') structureId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.tasksService.findStructureUsersForAssignment(
      structureId,
      user.sub,
      user.role,
    );
  }

  @Get('assigned')
  findAssigned(
    @Query() query: QueryAssignedTasksDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.tasksService.findAssignedByAdmin(query, user.sub, user.role);
  }

  @Get('my/pending')
  findMyPending(@CurrentUser() user: JwtPayload) {
    return this.tasksService.findMyPendingTasks(user.sub);
  }

  @Patch(':id/complete')
  completeTask(
    @Param('id', ParseMongoIdPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.tasksService.completeTask(id, user.sub, user.role);
  }

  @Patch(':id/cancel')
  cancelTask(
    @Param('id', ParseMongoIdPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.tasksService.cancelTask(id, user.sub, user.role);
  }

  @Get(':id/file')
  async downloadFile(
    @Param('id', ParseMongoIdPipe) id: string,
    @Query('storedName') storedName: string | undefined,
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.tasksService.getTaskFile(
      id,
      user.sub,
      user.role,
      storedName,
    );
    return file;
  }
}
