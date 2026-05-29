import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { StocktakeMode } from '../enums/stocktake-mode.enum';
import { StocktakeStatus } from '../enums/stocktake-status.enum';
import { StocktakeLine, StocktakeLineSchema } from './stocktake-line.schema';

export type StocktakeDocument = HydratedDocument<Stocktake>;

@Schema({
  timestamps: true,
  collection: 'stocktakes',
})
export class Stocktake {
  @Prop({ type: Types.ObjectId, ref: 'Structure', required: true, index: true })
  structureId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  structureName!: string;

  @Prop({ required: true, enum: StocktakeMode, index: true })
  mode!: StocktakeMode;

  @Prop({ type: Types.ObjectId, ref: 'WarehouseLocation', default: null })
  locationId?: Types.ObjectId | null;

  @Prop({ trim: true, default: '' })
  locationName!: string;

  @Prop({ required: true, trim: true, index: true })
  code!: string;

  @Prop({ required: true, enum: StocktakeStatus, default: StocktakeStatus.IN_PROGRESS, index: true })
  status!: StocktakeStatus;

  @Prop({ trim: true, default: '' })
  comment!: string;

  @Prop({ type: [StocktakeLineSchema], default: [] })
  lines!: StocktakeLine[];

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  createdBy!: Types.ObjectId;

  createdAt?: Date;
  updatedAt?: Date;
}

export const StocktakeSchema = SchemaFactory.createForClass(Stocktake);

StocktakeSchema.index({ structureId: 1, status: 1, createdAt: -1 });
StocktakeSchema.index({ createdBy: 1, status: 1 });
