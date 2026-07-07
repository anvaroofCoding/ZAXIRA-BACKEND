import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ _id: false })
export class TaskFileEmbeddable {
  @Prop({ required: true, trim: true })
  storedName!: string;

  @Prop({ required: true, trim: true })
  originalName!: string;

  @Prop({ required: true, trim: true })
  mimeType!: string;

  @Prop({ required: true, min: 0 })
  size!: number;
}

export const TaskFileSchema = SchemaFactory.createForClass(TaskFileEmbeddable);
