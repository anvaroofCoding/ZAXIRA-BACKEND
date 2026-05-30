import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ChatMessageDocument = HydratedDocument<ChatMessage>;

export enum ChatRoomType {
  GLOBAL = 'GLOBAL',
  SUPPORT = 'SUPPORT',
  DIRECT = 'DIRECT',
}

@Schema({
  timestamps: true,
  collection: 'chat_messages',
})
export class ChatMessage {
  @Prop({
    type: String,
    enum: ChatRoomType,
    required: true,
    index: true,
  })
  roomType!: ChatRoomType;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  senderId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  supportRequesterId?: Types.ObjectId | null;

  @Prop({ type: String, trim: true, default: '' })
  text!: string;

  // Frontend MVP uchun bir dona rasm (data URL) saqlanadi.
  @Prop({ type: String, default: '' })
  imageDataUrl!: string;

  @Prop({ type: String, default: '' })
  fileDataUrl!: string;

  @Prop({ type: String, trim: true, default: '' })
  fileName!: string;

  @Prop({ type: String, trim: true, default: '' })
  fileMime!: string;

  @Prop({ type: String, trim: true, default: '' })
  directConversationKey!: string;

  @Prop({
    type: [
      {
        emoji: { type: String, required: true, trim: true },
        userId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
      },
    ],
    default: [],
  })
  reactions!: Array<{ emoji: string; userId: Types.ObjectId }>;

  @Prop({
    type: {
      messageId: { type: Types.ObjectId, ref: 'ChatMessage', required: true },
      senderId: { type: Types.ObjectId, ref: 'User', required: true },
      senderName: { type: String, default: '' },
      text: { type: String, default: '' },
      hasImage: { type: Boolean, default: false },
      hasFile: { type: Boolean, default: false },
    },
    default: null,
  })
  replyTo?: {
    messageId: Types.ObjectId;
    senderId: Types.ObjectId;
    senderName: string;
    text: string;
    hasImage: boolean;
    hasFile: boolean;
  } | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const ChatMessageSchema = SchemaFactory.createForClass(ChatMessage);

ChatMessageSchema.index({ roomType: 1, createdAt: -1 });
ChatMessageSchema.index({ directConversationKey: 1, createdAt: -1 });
ChatMessageSchema.index({ supportRequesterId: 1, createdAt: -1 });
