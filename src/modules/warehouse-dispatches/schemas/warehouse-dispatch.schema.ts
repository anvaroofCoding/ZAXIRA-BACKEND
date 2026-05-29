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
import { WarehouseDispatchStatus } from '../enums/warehouse-dispatch-status.enum';
import {
  DispatchItemEmbeddable,
  DispatchItemSchema,
} from './dispatch-item.schema';

export type WarehouseDispatchDocument = HydratedDocument<WarehouseDispatch>;

@Schema({
  timestamps: true,
  collection: 'warehouse_dispatches',
})
export class WarehouseDispatch {
  @Prop({ required: true, unique: true, index: true, uppercase: true, trim: true })
  dispatchCode!: string;

  @Prop({ type: Types.ObjectId, ref: 'PurchaseRequest', required: false, index: true, sparse: true })
  purchaseRequestId?: Types.ObjectId | null;

  @Prop({ required: true, trim: true, index: true })
  requestCode!: string;

  @Prop({
    type: String,
    enum: WarehouseDispatchStatus,
    default: WarehouseDispatchStatus.PENDING_RECEIPT,
    index: true,
  })
  status!: WarehouseDispatchStatus;

  @Prop({ type: StructureSnapshotSchema, required: true })
  targetStructure!: StructureSnapshotEmbeddable;

  @Prop({ type: Types.ObjectId, ref: 'Structure', required: false, index: true })
  sourceStructureId?: Types.ObjectId | null;

  @Prop({ type: StructureSnapshotSchema, required: false })
  sourceStructure?: StructureSnapshotEmbeddable;

  @Prop({ type: [DispatchItemSchema], required: true })
  items!: DispatchItemEmbeddable[];

  @Prop()
  plannedArrivalAt?: Date;

  @Prop({ type: UserSnapshotSchema, required: true })
  dispatchedBy!: UserSnapshotEmbeddable;

  @Prop({ required: true })
  dispatchedAt!: Date;

  @Prop({ default: false, index: true })
  isSeenByReceiver!: boolean;

  createdAt?: Date;
  updatedAt?: Date;
}

export const WarehouseDispatchSchema =
  SchemaFactory.createForClass(WarehouseDispatch);

WarehouseDispatchSchema.index({ 'targetStructure.structureId': 1, status: 1 });
