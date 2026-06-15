import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ChatRoomType } from '../schemas/chat-message.schema';

export class QueryChatMessagesDto {
  @IsEnum(ChatRoomType)
  roomType!: ChatRoomType;

  @IsOptional()
  @IsString()
  directPeerUserId?: string;

  @IsOptional()
  @IsString()
  supportRequesterId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 40;
}
