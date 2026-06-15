import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ChatRoomType } from '../schemas/chat-message.schema';

export class MarkChatReadDto {
  @IsEnum(ChatRoomType)
  roomType!: ChatRoomType;

  @IsOptional()
  @IsString()
  directPeerUserId?: string;

  @IsOptional()
  @IsString()
  supportRequesterId?: string;
}
