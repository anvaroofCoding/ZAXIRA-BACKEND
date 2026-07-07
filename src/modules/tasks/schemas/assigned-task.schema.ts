import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  StructureSnapshotEmbeddable,
  StructureSnapshotSchema,
} from '../../structures/schemas/structure-snapshot.schema';
import {
  UserSnapshotEmbeddable,
  UserSnapshotSchema,
} from '../../purchase-requests/schemas/user-snapshot.schema';
import { AssignedTaskStatus } from '../enums/assigned-task-status.enum';
import { TaskFileEmbeddable } from './task-file.schema';

export type AssignedTaskDocument = HydratedDocument<AssignedTask>;

@Schema({
  timestamps: true,
  collection: 'assigned_tasks',
})
export class AssignedTask {
  @Prop({ required: true, trim: true, index: true })
  groupId!: string;

  @Prop({ type: StructureSnapshotEmbeddable, required: true })
  structure!: StructureSnapshotEmbeddable;

  @Prop({ type: UserSnapshotEmbeddable, required: true })
  assignee!: UserSnapshotEmbeddable;

  @Prop({ type: UserSnapshotEmbeddable, required: true })
  assignedBy!: UserSnapshotEmbeddable;

  @Prop({ required: true, trim: true })
  title!: string;

  @Prop({ required: true, trim: true })
  description!: string;

  @Prop({ required: true, index: true })
  dueDate!: Date;

  @Prop({ type: TaskFileEmbeddable })
  file?: TaskFileEmbeddable;

  @Prop({ type: [TaskFileEmbeddable], default: [] })
  files!: TaskFileEmbeddable[];

  @Prop({
    type: String,
    enum: AssignedTaskStatus,
    default: AssignedTaskStatus.PENDING,
    index: true,
  })
  status!: AssignedTaskStatus;

  @Prop()
  completedAt?: Date;

  createdAt?: Date;
  updatedAt?: Date;
}

export const AssignedTaskSchema = SchemaFactory.createForClass(AssignedTask);

AssignedTaskSchema.index({ 'assignee.userId': 1, status: 1, dueDate: 1 });
AssignedTaskSchema.index({ 'assignedBy.userId': 1, createdAt: -1 });
AssignedTaskSchema.index({ 'structure.structureId': 1, createdAt: -1 });
AssignedTaskSchema.index({ dueDate: 1, status: 1 });
