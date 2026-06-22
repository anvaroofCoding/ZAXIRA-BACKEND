import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AppSettingDocument = HydratedDocument<AppSetting>;

@Schema({
  timestamps: true,
  collection: 'app_settings',
})
export class AppSetting {
  @Prop({ required: true, unique: true, trim: true })
  key!: string;

  @Prop({ type: String, default: '' })
  value!: string;
}

export const AppSettingSchema = SchemaFactory.createForClass(AppSetting);
