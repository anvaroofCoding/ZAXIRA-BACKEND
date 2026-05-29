import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type SequenceDocument = HydratedDocument<Sequence>;

@Schema({ collection: 'sequences' })
export class Sequence {
  @Prop({ required: true, unique: true })
  key!: string;

  @Prop({ required: true, default: 0 })
  value!: number;
}

export const SequenceSchema = SchemaFactory.createForClass(Sequence);
