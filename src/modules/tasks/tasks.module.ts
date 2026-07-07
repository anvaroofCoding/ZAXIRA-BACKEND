import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NotificationsModule } from '../notifications/notifications.module';
import { StructuresModule } from '../structures/structures.module';
import { UsersModule } from '../users/users.module';
import {
  AssignedTask,
  AssignedTaskSchema,
} from './schemas/assigned-task.schema';
import { TaskFilesService } from './task-files.service';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AssignedTask.name, schema: AssignedTaskSchema },
    ]),
    UsersModule,
    StructuresModule,
    NotificationsModule,
  ],
  controllers: [TasksController],
  providers: [TasksService, TaskFilesService],
  exports: [TasksService],
})
export class TasksModule {}
