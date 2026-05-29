import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { QueryChatMessagesDto } from './dto/query-chat-messages.dto';
import { SendChatMessageDto } from './dto/send-chat-message.dto';
import { ChatService } from './chat.service';
import { ChatRoomType } from './schemas/chat-message.schema';

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get('messages')
  listMessages(
    @Query() query: QueryChatMessagesDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.chatService.listMessages(query, user.sub, user.role);
  }

  @Post('messages')
  sendMessage(
    @Body() dto: SendChatMessageDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.chatService.sendMessage(dto, user.sub, user.role);
  }

  @Post('typing')
  async setTyping(
    @Body()
    dto: {
      roomType: ChatRoomType;
      directPeerUserId?: string;
      supportRequesterId?: string;
      isTyping: boolean;
    },
    @CurrentUser() user: JwtPayload,
  ) {
    await this.chatService.emitTyping(dto, user.sub, user.role);
    return { success: true };
  }

  @Post('messages/:id/reaction')
  toggleReaction(
    @Param('id') id: string,
    @Body() dto: { emoji: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.chatService.toggleReaction(id, dto.emoji, user.sub);
  }
}
