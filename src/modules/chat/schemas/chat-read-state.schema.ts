import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ChatRoomType } from './chat-message.schema';

export type ChatReadStateDocument = HydratedDocument<ChatReadState>;

@Schema({
  timestamps: true,
  collection: 'chat_read_states',
})
export class ChatReadState {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({
    type: String,
    enum: ChatRoomType,
    required: true,
    index: true,
  })
  roomType!: ChatRoomType;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  directPeerUserId?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  supportRequesterId?: Types.ObjectId | null;

  @Prop({ type: Date, required: true })
  lastReadAt!: Date;
}

export const ChatReadStateSchema = SchemaFactory.createForClass(ChatReadState);

ChatReadStateSchema.index(
  { userId: 1, roomType: 1, directPeerUserId: 1, supportRequesterId: 1 },
  { unique: true },
);
