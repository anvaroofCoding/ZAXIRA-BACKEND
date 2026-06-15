import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
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
import { MarkChatReadDto } from './dto/mark-chat-read.dto';
import { QueryChatMessagesDto } from './dto/query-chat-messages.dto';
import { SendChatMessageDto } from './dto/send-chat-message.dto';
import {
  ChatMessage,
  ChatMessageDocument,
  ChatRoomType,
} from './schemas/chat-message.schema';
import {
  ChatReadState,
  ChatReadStateDocument,
} from './schemas/chat-read-state.schema';

const MAX_IMAGE_SIZE_BYTES = 1024 * 1024 * 2; // 2MB
const MAX_FILE_SIZE_BYTES = 1024 * 1024 * 5; // 5MB

@Injectable()
export class ChatService {
  constructor(
    @InjectModel(ChatMessage.name)
    private readonly chatMessageModel: Model<ChatMessageDocument>,
    @InjectModel(ChatReadState.name)
    private readonly chatReadStateModel: Model<ChatReadStateDocument>,
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

  private messagePreview(doc: {
    text?: string;
    imageDataUrl?: string;
    fileDataUrl?: string;
    fileName?: string;
  }): string {
    const text = doc.text?.trim();
    if (text) return text;
    if (doc.imageDataUrl) return '📷 Rasm';
    if (doc.fileDataUrl) return doc.fileName?.trim() || '📎 Fayl';
    return '';
  }

  private readStateKey(input: {
    roomType: ChatRoomType;
    directPeerUserId?: string | null;
    supportRequesterId?: string | null;
  }): string {
    return [
      input.roomType,
      input.directPeerUserId ?? '',
      input.supportRequesterId ?? '',
    ].join('|');
  }

  private async getLastReadAtMap(userId: string) {
    const docs = await this.chatReadStateModel
      .find({ userId: new Types.ObjectId(userId) })
      .exec();

    const map = new Map<string, Date>();
    for (const doc of docs) {
      map.set(
        this.readStateKey({
          roomType: doc.roomType,
          directPeerUserId: doc.directPeerUserId
            ? String(doc.directPeerUserId)
            : null,
          supportRequesterId: doc.supportRequesterId
            ? String(doc.supportRequesterId)
            : null,
        }),
        doc.lastReadAt,
      );
    }
    return map;
  }

  private countUnreadSince(
    messages: Array<{ createdAt?: Date; senderId: Types.ObjectId | string }>,
    userId: string,
    lastReadAt: Date | null,
  ): number {
    const threshold = lastReadAt ?? new Date(0);
    return messages.filter(
      (m) =>
        String(m.senderId) !== userId &&
        (m.createdAt ? m.createdAt > threshold : false),
    ).length;
  }

  private async countUnreadInRoom(
    filter: Record<string, unknown>,
    userId: string,
    lastReadAt: Date | null,
  ): Promise<number> {
    const threshold = lastReadAt ?? new Date(0);
    return this.chatMessageModel.countDocuments({
      ...filter,
      senderId: { $ne: new Types.ObjectId(userId) },
      createdAt: { $gt: threshold },
    });
  }

  private async upsertReadState(
    userId: string,
    input: {
      roomType: ChatRoomType;
      directPeerUserId?: string | null;
      supportRequesterId?: string | null;
    },
    at: Date = new Date(),
  ) {
    await this.chatReadStateModel
      .findOneAndUpdate(
        {
          userId: new Types.ObjectId(userId),
          roomType: input.roomType,
          directPeerUserId: input.directPeerUserId
            ? new Types.ObjectId(input.directPeerUserId)
            : null,
          supportRequesterId: input.supportRequesterId
            ? new Types.ObjectId(input.supportRequesterId)
            : null,
        },
        { lastReadAt: at },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
  }

  private emitSummaryUpdated(userId: string) {
    const server = this.realtimeGateway.server;
    if (!server) return;
    server.to(`user:${userId}`).emit('chat:summary', { updatedAt: Date.now() });
  }

  async markAsRead(dto: MarkChatReadDto, userId: string, role?: UserRole) {
    if (dto.roomType === ChatRoomType.DIRECT) {
      if (
        !dto.directPeerUserId ||
        !Types.ObjectId.isValid(dto.directPeerUserId)
      ) {
        throw new BadRequestException('Lichka uchun foydalanuvchi tanlang');
      }
      await this.upsertReadState(userId, {
        roomType: ChatRoomType.DIRECT,
        directPeerUserId: dto.directPeerUserId,
      });
    } else if (dto.roomType === ChatRoomType.SUPPORT) {
      const requesterUser = await this.usersService.findById(userId);
      const canViewAllSupport = this.isSupportOperator(requesterUser);
      let supportRequesterId: string | null = userId;
      if (isSuperAdminRole(role) || canViewAllSupport) {
        if (
          !dto.supportRequesterId ||
          !Types.ObjectId.isValid(dto.supportRequesterId)
        ) {
          throw new BadRequestException('Support foydalanuvchisi tanlang');
        }
        supportRequesterId = dto.supportRequesterId;
      }
      await this.upsertReadState(userId, {
        roomType: ChatRoomType.SUPPORT,
        supportRequesterId,
      });
    } else if (dto.roomType === ChatRoomType.GLOBAL) {
      await this.upsertReadState(userId, { roomType: ChatRoomType.GLOBAL });
    } else {
      throw new BadRequestException('Chat turi noto‘g‘ri');
    }

    this.emitSummaryUpdated(userId);
    return { success: true };
  }

  async getSummary(userId: string, role?: UserRole) {
    const readMap = await this.getLastReadAtMap(userId);
    const userObjectId = new Types.ObjectId(userId);
    const requesterUser = await this.usersService.findById(userId);
    const isOperator =
      isSuperAdminRole(role) || this.isSupportOperator(requesterUser);

    const globalLastRead =
      readMap.get(this.readStateKey({ roomType: ChatRoomType.GLOBAL })) ?? null;
    const globalMessages = await this.chatMessageModel
      .find({ roomType: ChatRoomType.GLOBAL })
      .sort({ createdAt: -1 })
      .limit(1)
      .exec();
    const globalUnread = await this.countUnreadInRoom(
      { roomType: ChatRoomType.GLOBAL },
      userId,
      globalLastRead,
    );
    const globalLatest = globalMessages[0];
    const global = {
      unreadCount: globalUnread,
      lastMessageText: globalLatest ? this.messagePreview(globalLatest) : '',
      lastMessageAt: globalLatest?.createdAt ?? null,
    };

    let support: {
      unreadCount: number;
      lastMessageText: string;
      lastMessageAt: Date | null | undefined;
    } | null = null;
    const supportThreads: Array<{
      requesterId: string;
      requesterName: string;
      unreadCount: number;
      lastMessageText: string;
      lastMessageAt: Date | null | undefined;
    }> = [];

    if (isOperator) {
      const supportDocs = await this.chatMessageModel
        .find({
          roomType: ChatRoomType.SUPPORT,
          supportRequesterId: { $ne: null },
        })
        .sort({ createdAt: -1 })
        .limit(500)
        .exec();

      const byRequester = new Map<string, ChatMessageDocument[]>();
      for (const doc of supportDocs) {
        const requesterId = String(doc.supportRequesterId);
        const bucket = byRequester.get(requesterId) ?? [];
        bucket.push(doc);
        byRequester.set(requesterId, bucket);
      }

      const requesterIds = [...byRequester.keys()];
      const requesterUsers = await Promise.all(
        requesterIds.map((id) => this.usersService.findById(id)),
      );
      const requesterNameMap = new Map(
        requesterUsers
          .filter((u) => Boolean(u))
          .map((u) => [String(u!._id), u!.displayName || u!.login]),
      );

      for (const [requesterId, docs] of byRequester.entries()) {
        const lastRead =
          readMap.get(
            this.readStateKey({
              roomType: ChatRoomType.SUPPORT,
              supportRequesterId: requesterId,
            }),
          ) ?? null;
        const unreadCount = await this.countUnreadInRoom(
          {
            roomType: ChatRoomType.SUPPORT,
            supportRequesterId: new Types.ObjectId(requesterId),
          },
          userId,
          lastRead,
        );
        const latest = docs[0];
        supportThreads.push({
          requesterId,
          requesterName: requesterNameMap.get(requesterId) ?? 'Foydalanuvchi',
          unreadCount,
          lastMessageText: latest ? this.messagePreview(latest) : '',
          lastMessageAt: latest?.createdAt ?? null,
        });
      }

      supportThreads.sort((a, b) => {
        const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
        const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
        return bTime - aTime;
      });
    } else {
      const supportLastRead =
        readMap.get(
          this.readStateKey({
            roomType: ChatRoomType.SUPPORT,
            supportRequesterId: userId,
          }),
        ) ?? null;
      const supportMessages = await this.chatMessageModel
        .find({
          roomType: ChatRoomType.SUPPORT,
          supportRequesterId: userObjectId,
        })
        .sort({ createdAt: -1 })
        .limit(1)
        .exec();
      const supportUnread = await this.countUnreadInRoom(
        {
          roomType: ChatRoomType.SUPPORT,
          supportRequesterId: userObjectId,
        },
        userId,
        supportLastRead,
      );
      const supportLatest = supportMessages[0];
      support = {
        unreadCount: supportUnread,
        lastMessageText: supportLatest
          ? this.messagePreview(supportLatest)
          : '',
        lastMessageAt: supportLatest?.createdAt ?? null,
      };
    }

    const peers = await this.usersService.findActiveLookup();
    const peerIds = peers.map((p) => p.id).filter((id) => id !== userId);
    const directKeys = peerIds.map((peerId) =>
      this.buildDirectConversationKey(userId, peerId),
    );

    const directGrouped = directKeys.length
      ? await this.chatMessageModel.aggregate<{
          _id: string;
          recent: Array<{
            senderId: Types.ObjectId;
            createdAt?: Date;
            text?: string;
            imageDataUrl?: string;
            fileDataUrl?: string;
            fileName?: string;
          }>;
        }>([
          {
            $match: {
              roomType: ChatRoomType.DIRECT,
              directConversationKey: { $in: directKeys },
            },
          },
          { $sort: { createdAt: -1 } },
          {
            $group: {
              _id: '$directConversationKey',
              recent: {
                $push: {
                  senderId: '$senderId',
                  createdAt: '$createdAt',
                  text: '$text',
                  imageDataUrl: '$imageDataUrl',
                  fileDataUrl: '$fileDataUrl',
                  fileName: '$fileName',
                },
              },
            },
          },
          { $project: { recent: { $slice: ['$recent', 80] } } },
        ])
      : [];

    const directByKey = new Map(
      directGrouped.map((row) => [row._id, row.recent ?? []]),
    );

    const keyToPeerId = new Map(
      peerIds.map((peerId) => [
        this.buildDirectConversationKey(userId, peerId),
        peerId,
      ]),
    );

    const direct: Record<
      string,
      {
        unreadCount: number;
        lastMessageText: string;
        lastMessageAt: Date | null | undefined;
      }
    > = {};

    for (const [key, docs] of directByKey.entries()) {
      const peerId = keyToPeerId.get(key);
      if (!peerId) continue;
      const lastRead =
        readMap.get(
          this.readStateKey({
            roomType: ChatRoomType.DIRECT,
            directPeerUserId: peerId,
          }),
        ) ?? null;
      const unreadCount = await this.countUnreadInRoom(
        {
          roomType: ChatRoomType.DIRECT,
          directConversationKey: key,
        },
        userId,
        lastRead,
      );
      const latest = docs[0];
      if (unreadCount > 0 || latest) {
        direct[peerId] = {
          unreadCount,
          lastMessageText: latest ? this.messagePreview(latest) : '',
          lastMessageAt: latest?.createdAt ?? null,
        };
      }
    }

    const supportUnreadTotal = isOperator
      ? supportThreads.reduce((sum, t) => sum + t.unreadCount, 0)
      : (support?.unreadCount ?? 0);
    const directUnreadTotal = Object.values(direct).reduce(
      (sum, item) => sum + item.unreadCount,
      0,
    );
    const totalUnread = globalUnread + supportUnreadTotal + directUnreadTotal;

    return {
      totalUnread,
      global,
      support,
      supportThreads,
      direct,
    };
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
      replyTo: doc.replyTo
        ? {
            messageId: String(doc.replyTo.messageId),
            senderId: String(doc.replyTo.senderId),
            senderName: doc.replyTo.senderName || '',
            text: doc.replyTo.text || '',
            hasImage: Boolean(doc.replyTo.hasImage),
            hasFile: Boolean(doc.replyTo.hasFile),
          }
        : null,
      reactions: Array.from(reactionMap.entries()).map(([emoji, count]) => ({
        emoji,
        count,
      })),
      createdAt: doc.createdAt,
    };
  }

  private async enrichSenderNames(
    messages: ReturnType<ChatService['mapMessage']>[],
  ) {
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
      if (
        !query.directPeerUserId ||
        !Types.ObjectId.isValid(query.directPeerUserId)
      ) {
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
        if (
          !query.supportRequesterId ||
          !Types.ObjectId.isValid(query.supportRequesterId)
        ) {
          return [];
        }
        filter.supportRequesterId = new Types.ObjectId(
          query.supportRequesterId,
        );
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

  private messageBelongsToRoom(
    message: ChatMessageDocument,
    dto: SendChatMessageDto,
    userId: string,
    directConversationKey: string,
    supportRequesterId: Types.ObjectId | null,
  ): boolean {
    if (message.roomType !== dto.roomType) return false;
    if (dto.roomType === ChatRoomType.GLOBAL) return true;
    if (dto.roomType === ChatRoomType.DIRECT) {
      return message.directConversationKey === directConversationKey;
    }
    if (dto.roomType === ChatRoomType.SUPPORT) {
      return (
        String(message.supportRequesterId ?? '') ===
        String(supportRequesterId ?? userId)
      );
    }
    return false;
  }

  private buildReplySnapshot(message: ChatMessageDocument, senderName: string) {
    return {
      messageId: message._id,
      senderId: message.senderId,
      senderName,
      text: this.messagePreview(message),
      hasImage: Boolean(message.imageDataUrl),
      hasFile: Boolean(message.fileDataUrl && !message.imageDataUrl),
    };
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
      throw new BadRequestException(
        'Bir xabarda faqat 1 ta biriktirma yuboriladi',
      );
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
      if (
        !dto.directPeerUserId ||
        !Types.ObjectId.isValid(dto.directPeerUserId)
      ) {
        throw new BadRequestException('Lichka uchun foydalanuvchi tanlang');
      }
      directConversationKey = this.buildDirectConversationKey(
        userId,
        dto.directPeerUserId,
      );
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

    let replyTo: ReturnType<ChatService['buildReplySnapshot']> | null = null;
    if (dto.replyToMessageId) {
      if (!Types.ObjectId.isValid(dto.replyToMessageId)) {
        throw new BadRequestException('Javob xabari noto‘g‘ri');
      }
      const replyMessage = await this.chatMessageModel
        .findById(dto.replyToMessageId)
        .exec();
      if (!replyMessage) {
        throw new BadRequestException('Javob berilayotgan xabar topilmadi');
      }
      if (
        !this.messageBelongsToRoom(
          replyMessage,
          dto,
          userId,
          directConversationKey,
          supportRequesterId,
        )
      ) {
        throw new BadRequestException(
          'Javob faqat shu chat ichidagi xabarga beriladi',
        );
      }
      const replySender = await this.usersService.findById(
        String(replyMessage.senderId),
      );
      replyTo = this.buildReplySnapshot(
        replyMessage,
        replySender?.displayName || replySender?.login || 'Foydalanuvchi',
      );
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
      replyTo,
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
        server
          .to('chat:global')
          .emit('chat:summary', { updatedAt: Date.now() });
      } else if (dto.roomType === ChatRoomType.DIRECT) {
        const peer = dto.directPeerUserId!;
        server.to(`user:${userId}`).emit('chat:message', payload);
        server.to(`user:${peer}`).emit('chat:message', payload);
        this.emitSummaryUpdated(userId);
        this.emitSummaryUpdated(peer);
      } else if (dto.roomType === ChatRoomType.SUPPORT) {
        const targetUserId = String(supportRequesterId ?? userId);
        const operators = await this.getSupportOperatorIds();
        operators.forEach((operatorId) => {
          server.to(`user:${operatorId}`).emit('chat:message', payload);
          this.emitSummaryUpdated(operatorId);
        });
        server.to(`user:${targetUserId}`).emit('chat:message', payload);
        this.emitSummaryUpdated(targetUserId);
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
      if (
        !input.directPeerUserId ||
        !Types.ObjectId.isValid(input.directPeerUserId)
      ) {
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
        server
          .to(`user:${input.supportRequesterId}`)
          .emit('chat:typing', payload);
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
