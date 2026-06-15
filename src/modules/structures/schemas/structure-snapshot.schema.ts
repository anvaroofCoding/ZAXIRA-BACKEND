import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

/**
 * Har bir biznes yozuviga (xarid, transfer va h.k.) qo'shiladi.
 * Foydalanuvchi tuzilmasini o'zgartirganda mavjud yozuvlardagi snapshot o'zgarmaydi.
 */
@Schema({ _id: false })
export class StructureSnapshotEmbeddable {
  @Prop({ type: Types.ObjectId, required: true })
  structureId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  fullName!: string;

  @Prop({ required: true, trim: true, uppercase: true })
  shortName!: string;

  @Prop({ trim: true, default: '' })
  leaderName!: string;

  @Prop({ default: () => new Date() })
  capturedAt!: Date;
}

export const StructureSnapshotSchema = SchemaFactory.createForClass(
  StructureSnapshotEmbeddable,
);
