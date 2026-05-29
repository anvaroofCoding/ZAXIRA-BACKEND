import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ChatRoomType } from '../schemas/chat-message.schema';

export class SendChatMessageDto {
  @IsEnum(ChatRoomType)
  roomType!: ChatRoomType;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  text?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1_000_000)
  imageDataUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8_000_000)
  fileDataUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  fileName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  fileMime?: string;

  @IsOptional()
  @IsString()
  directPeerUserId?: string;

  @IsOptional()
  @IsString()
  supportRequesterId?: string;
}
