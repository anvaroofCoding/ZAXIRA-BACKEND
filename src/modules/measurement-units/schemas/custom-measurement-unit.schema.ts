import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CustomMeasurementUnitDocument =
  HydratedDocument<CustomMeasurementUnit>;

@Schema({
  timestamps: true,
  collection: 'custom_measurement_units',
})
export class CustomMeasurementUnit {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, trim: true, lowercase: true })
  nameLower!: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export const CustomMeasurementUnitSchema = SchemaFactory.createForClass(
  CustomMeasurementUnit,
);

CustomMeasurementUnitSchema.index({ userId: 1, nameLower: 1 }, { unique: true });
CustomMeasurementUnitSchema.index({ name: 1 });
