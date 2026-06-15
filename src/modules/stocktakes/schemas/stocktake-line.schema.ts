import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ _id: false })
export class StocktakeLine {
  @Prop({ required: true, trim: true })
  lineKey!: string;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, trim: true, default: '' })
  characteristics!: string;

  @Prop({ required: true, trim: true })
  barcode!: string;

  @Prop({ trim: true, default: '' })
  nomenclatureCode?: string;

  @Prop({ required: true, min: 0 })
  bookQuantity!: number;

  @Prop({ required: true, min: 0, default: 0 })
  countedQuantity!: number;

  /** Ko‘p qismidan skladdan ayirilgan miqdor (boshqaruv) */
  @Prop({ required: true, min: 0, default: 0 })
  excessDeductQuantity!: number;

  /** Kam qismi uchun skladga qo‘shilgan miqdor (boshqaruv) */
  @Prop({ required: true, min: 0, default: 0 })
  shortageAddQuantity!: number;
}

export const StocktakeLineSchema = SchemaFactory.createForClass(StocktakeLine);
