import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { UserRole } from '../../common/enums/user-role.enum';
import { isSuperAdminRole } from '../../common/utils/super-admin.util';
import { UsersService } from '../users/users.service';
import { User, UserDocument } from '../users/schemas/user.schema';
import { ALL_PERMISSION_PATHS } from '../users/constants/permission-catalog';
import { normalizePermissions } from '../users/utils/permissions.util';
import { UserPermissionsMap } from '../users/types/page-permission.type';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { QueryChatMessagesDto } from './dto/query-chat-messages.dto';
import { SendChatMessageDto } from './dto/send-chat-message.dto';
import {
  ChatMessage,
  ChatMessageDocument,
  ChatRoomType,
} from './schemas/chat-message.schema';

const MAX_IMAGE_SIZE_BYTES = 1024 * 1024 * 2; // 2MB
const MAX_FILE_SIZE_BYTES = 1024 * 1024 * 5; // 5MB

@Injectable()
export class ChatService {
  constructor(
    @InjectModel(ChatMessage.name)
    private readonly chatMessageModel: Model<ChatMessageDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly usersService: UsersService,
    private readonly realtimeGateway: RealtimeGateway,
  ) {}

  private isSupportOperator(user: UserDocument | null | undefined): boolean {
    if (!user || !user.isActive) return false;
    if (user.role === UserRole.SUPER_ADMIN || user.role === UserRole.ADMIN) {
      return true;
    }
    const normalized = normalizePermissions(
      user.permissions as UserPermissionsMap,
    );
    return ALL_PERMISSION_PATHS.every((path) => {
      const page = normalized[path];
      return Boolean(
        page?.access &&
          page?.actions?.create &&
          page?.actions?.update &&
          page?.actions?.delete,
      );
    });
  }

  private async getSupportOperatorIds(): Promise<string[]> {
    const users = await this.userModel.find({ isActive: true }).exec();
    return users
      .filter((u) => this.isSupportOperator(u))
      .map((u) => String(u._id));
  }

  private buildDirectConversationKey(a: string, b: string): string {
    return [a, b].sort().join(':');
  }

  private decodeDataUrlSize(dataUrl: string): number {
    const raw = dataUrl.split(',')[1] ?? '';
    return Buffer.from(raw, 'base64').byteLength;
  }

  private mapMessage(doc: ChatMessageDocument) {
    const reactionMap = new Map<string, number>();
    for (const reaction of doc.reactions ?? []) {
      reactionMap.set(
        reaction.emoji,
        (reactionMap.get(reaction.emoji) ?? 0) + 1,
      );
    }

    return {
      id: doc.id,
      roomType: doc.roomType,
      senderId: String(doc.senderId),
      senderName: '',
      supportRequesterId: doc.supportRequesterId
        ? String(doc.supportRequesterId)
        : null,
      text: doc.text,
      imageDataUrl: doc.imageDataUrl || '',
      fileDataUrl: doc.fileDataUrl || '',
      fileName: doc.fileName || '',
      fileMime: doc.fileMime || '',
      reactions: Array.from(reactionMap.entries()).map(([emoji, count]) => ({
        emoji,
        count,
      })),
      createdAt: doc.createdAt,
    };
  }

  private async enrichSenderNames(messages: ReturnType<ChatService['mapMessage']>[]) {
    const senderIds = [...new Set(messages.map((m) => m.senderId))];
    const users = await Promise.all(
      senderIds.map((id) => this.usersService.findById(id)),
    );
    const nameMap = new Map(
      users
        .filter((u) => Boolean(u))
        .map((u) => [String(u!._id), u!.displayName || u!.login]),
    );

    return messages.map((m) => ({
      ...m,
      senderName: nameMap.get(m.senderId) ?? 'Foydalanuvchi',
    }));
  }

  async listMessages(
    query: QueryChatMessagesDto,
    userId: string,
    role?: UserRole,
  ) {
    const limit = query.limit ?? 40;
    const filter: Record<string, unknown> = {
      roomType: query.roomType,
    };

    if (query.roomType === ChatRoomType.DIRECT) {
      if (!query.directPeerUserId || !Types.ObjectId.isValid(query.directPeerUserId)) {
        throw new BadRequestException('Lichka uchun foydalanuvchi tanlang');
      }
      filter.directConversationKey = this.buildDirectConversationKey(
        userId,
        query.directPeerUserId,
      );
    }

    if (query.roomType === ChatRoomType.SUPPORT) {
      const requesterUser = await this.usersService.findById(userId);
      const canViewAllSupport = this.isSupportOperator(requesterUser);
      if (isSuperAdminRole(role) || canViewAllSupport) {
        if (!query.supportRequesterId || !Types.ObjectId.isValid(query.supportRequesterId)) {
          return [];
        }
        filter.supportRequesterId = new Types.ObjectId(query.supportRequesterId);
      } else {
        filter.supportRequesterId = new Types.ObjectId(userId);
      }
    }

    const docs = await this.chatMessageModel
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();

    const mapped = docs.map((d) => this.mapMessage(d)).reverse();
    return this.enrichSenderNames(mapped);
  }

  async sendMessage(dto: SendChatMessageDto, userId: string, role?: UserRole) {
    const text = dto.text?.trim() ?? '';
    const imageDataUrl = dto.imageDataUrl?.trim() ?? '';
    const fileDataUrl = dto.fileDataUrl?.trim() ?? '';
    const fileName = dto.fileName?.trim() ?? '';
    const fileMime = dto.fileMime?.trim() ?? '';

    if (!text && !imageDataUrl && !fileDataUrl) {
      throw new BadRequestException('Xabar, rasm yoki fayl yuborilishi shart');
    }

    if (imageDataUrl && fileDataUrl) {
      throw new BadRequestException('Bir xabarda faqat 1 ta biriktirma yuboriladi');
    }

    if (imageDataUrl) {
      if (!imageDataUrl.startsWith('data:image/')) {
        throw new BadRequestException('Faqat rasm yuborish mumkin');
      }
      const size = this.decodeDataUrlSize(imageDataUrl);
      if (size > MAX_IMAGE_SIZE_BYTES) {
        throw new BadRequestException('Rasm hajmi 2MB dan oshmasligi kerak');
      }
    }

    if (fileDataUrl) {
      if (!fileDataUrl.startsWith('data:')) {
        throw new BadRequestException('Fayl formati noto‘g‘ri');
      }
      const size = this.decodeDataUrlSize(fileDataUrl);
      if (size > MAX_FILE_SIZE_BYTES) {
        throw new BadRequestException('Fayl hajmi 5MB dan oshmasligi kerak');
      }
    }

    let directConversationKey = '';
    let supportRequesterId: Types.ObjectId | null = null;

    if (dto.roomType === ChatRoomType.DIRECT) {
      if (!dto.directPeerUserId || !Types.ObjectId.isValid(dto.directPeerUserId)) {
        throw new BadRequestException('Lichka uchun foydalanuvchi tanlang');
      }
      directConversationKey = this.buildDirectConversationKey(userId, dto.directPeerUserId);
    }

    if (dto.roomType === ChatRoomType.SUPPORT) {
      const senderUser = await this.usersService.findById(userId);
      const isOperator =
        isSuperAdminRole(role) || this.isSupportOperator(senderUser);
      if (
        isOperator &&
        dto.supportRequesterId &&
        Types.ObjectId.isValid(dto.supportRequesterId)
      ) {
        supportRequesterId = new Types.ObjectId(dto.supportRequesterId);
      } else if (!isOperator) {
        supportRequesterId = new Types.ObjectId(userId);
      } else {
        // Operator requester tanlamagan bo'lsa ham chatni bloklamaymiz.
        supportRequesterId = new Types.ObjectId(userId);
      }
    }

    const created = await this.chatMessageModel.create({
      roomType: dto.roomType,
      senderId: new Types.ObjectId(userId),
      text,
      imageDataUrl,
      fileDataUrl,
      fileName,
      fileMime,
      directConversationKey,
      supportRequesterId,
    });

    const sender = await this.usersService.findById(userId);
    const payload = {
      ...this.mapMessage(created),
      senderName: sender?.displayName || sender?.login || 'Foydalanuvchi',
    };

    const server = this.realtimeGateway.server;
    if (server) {
      if (dto.roomType === ChatRoomType.GLOBAL) {
        server.to('chat:global').emit('chat:message', payload);
      } else if (dto.roomType === ChatRoomType.DIRECT) {
        const peer = dto.directPeerUserId!;
        server.to(`user:${userId}`).emit('chat:message', payload);
        server.to(`user:${peer}`).emit('chat:message', payload);
      } else if (dto.roomType === ChatRoomType.SUPPORT) {
        const targetUserId = String(supportRequesterId ?? userId);
        const operators = await this.getSupportOperatorIds();
        operators.forEach((operatorId) => {
          server.to(`user:${operatorId}`).emit('chat:message', payload);
        });
        server.to(`user:${targetUserId}`).emit('chat:message', payload);
      }
    }

    return payload;
  }

  async toggleReaction(messageId: string, emoji: string, userId: string) {
    if (!Types.ObjectId.isValid(messageId)) {
      throw new BadRequestException('Xabar ID noto‘g‘ri');
    }

    const normalizedEmoji = emoji?.trim();
    if (!normalizedEmoji) {
      throw new BadRequestException('Emoji kiritilishi shart');
    }

    const message = await this.chatMessageModel.findById(messageId).exec();
    if (!message) {
      throw new BadRequestException('Xabar topilmadi');
    }

    const already = (message.reactions ?? []).find(
      (r) => String(r.userId) === userId && r.emoji === normalizedEmoji,
    );

    if (already) {
      message.reactions = (message.reactions ?? []).filter(
        (r) => !(String(r.userId) === userId && r.emoji === normalizedEmoji),
      );
    } else {
      message.reactions = [
        ...(message.reactions ?? []).filter((r) => String(r.userId) !== userId),
        { emoji: normalizedEmoji, userId: new Types.ObjectId(userId) },
      ];
    }

    await message.save();

    const mapped = this.mapMessage(message);
    const server = this.realtimeGateway.server;
    if (server) {
      if (message.roomType === ChatRoomType.GLOBAL) {
        server.to('chat:global').emit('chat:reaction', mapped);
      } else if (message.roomType === ChatRoomType.DIRECT) {
        const ids = (message.directConversationKey || '')
          .split(':')
          .filter(Boolean);
        ids.forEach((id) => {
          server.to(`user:${id}`).emit('chat:reaction', mapped);
        });
      } else if (message.roomType === ChatRoomType.SUPPORT) {
        const operators = await this.getSupportOperatorIds();
        operators.forEach((operatorId) => {
          server.to(`user:${operatorId}`).emit('chat:reaction', mapped);
        });
        if (message.supportRequesterId) {
          server
            .to(`user:${String(message.supportRequesterId)}`)
            .emit('chat:reaction', mapped);
        }
      }
    }

    return mapped;
  }

  async emitTyping(
    input: {
      roomType: ChatRoomType;
      directPeerUserId?: string;
      supportRequesterId?: string;
      isTyping: boolean;
    },
    userId: string,
    role?: UserRole,
  ) {
    const server = this.realtimeGateway.server;
    if (!server) return;

    const payload = {
      roomType: input.roomType,
      userId,
      isTyping: Boolean(input.isTyping),
      directPeerUserId: input.directPeerUserId ?? null,
      supportRequesterId: input.supportRequesterId ?? null,
    };

    if (input.roomType === ChatRoomType.GLOBAL) {
      server.to('chat:global').emit('chat:typing', payload);
      return;
    }

    if (input.roomType === ChatRoomType.DIRECT) {
      if (!input.directPeerUserId || !Types.ObjectId.isValid(input.directPeerUserId)) {
        throw new BadRequestException('Lichka foydalanuvchisi noto‘g‘ri');
      }
      server.to(`user:${input.directPeerUserId}`).emit('chat:typing', payload);
      return;
    }

    if (input.roomType === ChatRoomType.SUPPORT) {
      const senderUser = await this.usersService.findById(userId);
      const isOperator =
        isSuperAdminRole(role) || this.isSupportOperator(senderUser);
      if (isOperator && input.supportRequesterId) {
        if (!Types.ObjectId.isValid(input.supportRequesterId)) {
          throw new BadRequestException('Foydalanuvchi noto‘g‘ri');
        }
        server.to(`user:${input.supportRequesterId}`).emit('chat:typing', payload);
      } else {
        const operators = await this.getSupportOperatorIds();
        operators.forEach((operatorId) => {
          server.to(`user:${operatorId}`).emit('chat:typing', payload);
        });
      }
      return;
    }

    throw new ForbiddenException('Chat turi noto‘g‘ri');
  }
}
