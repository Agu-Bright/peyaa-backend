import { Injectable, Logger, OnModuleInit, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  NotificationToken,
  NotificationTokenDocument,
} from './schemas/notification-token.schema';
import {
  UserNotification,
  UserNotificationDocument,
  NotificationType,
} from './schemas/user-notification.schema';
import {
  NotificationLog,
  NotificationLogDocument,
  NotificationChannel,
  BroadcastRecipientGroup,
  BroadcastStatus,
} from './schemas/notification-log.schema';
import { User, UserDocument, UserStatus } from '../users/schemas/user.schema';
import { EmailService } from '../email/email.service';
import {
  paginate,
  calculateSkip,
} from '../common/utils/helpers';
import { PaginatedResult } from '../common/dto/pagination.dto';

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);
  private expo: any;
  private ExpoClass: any;

  constructor(
    @InjectModel(NotificationToken.name)
    private tokenModel: Model<NotificationTokenDocument>,
    @InjectModel(UserNotification.name)
    private notificationModel: Model<UserNotificationDocument>,
    @InjectModel(NotificationLog.name)
    private logModel: Model<NotificationLogDocument>,
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
    private readonly emailService: EmailService,
  ) {}

  async onModuleInit() {
    // Use Function constructor to force a real ESM dynamic import
    // (TypeScript's "module": "commonjs" would otherwise compile import() to require())
    const importDynamic = new Function('modulePath', 'return import(modulePath)');
    const expoModule = await importDynamic('expo-server-sdk');
    this.ExpoClass = expoModule.default ?? expoModule.Expo ?? expoModule;
    this.expo = new this.ExpoClass();
    this.logger.log('Expo Push SDK initialized');
  }

  // ============================================
  // TOKEN MANAGEMENT
  // ============================================

  async registerToken(
    userId: string,
    token: string,
    platform: string,
  ): Promise<void> {
    await this.tokenModel.findOneAndUpdate(
      { userId: new Types.ObjectId(userId), token },
      { userId: new Types.ObjectId(userId), token, platform, isActive: true },
      { upsert: true, new: true },
    );
    this.logger.log(`Token registered for user ${userId}`);
  }

  async unregisterToken(userId: string, token: string): Promise<void> {
    await this.tokenModel.deleteOne({
      userId: new Types.ObjectId(userId),
      token,
    });
    this.logger.log(`Token unregistered for user ${userId}`);
  }

  // ============================================
  // SEND NOTIFICATIONS (Push + Persist)
  // ============================================

  /**
   * Send a notification to a user.
   * Always persists to user_notifications.
   * Sends push via Expo Push API if user has active tokens.
   */
  async sendToUser(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, string>,
    type: NotificationType = NotificationType.SYSTEM,
    category?: string,
  ): Promise<void> {
    // 1. Always persist to in-app notifications
    try {
      await this.notificationModel.create({
        userId: new Types.ObjectId(userId),
        title,
        body,
        type,
        category: category || data?.type || null,
        data: data || {},
      });
    } catch (err) {
      this.logger.error(`Failed to persist notification for ${userId}: ${err.message}`);
    }

    // 2. Send push via Expo (best-effort)
    await this.sendPush(userId, title, body, data);
  }

  /**
   * Send a push notification to multiple users.
   */
  async sendToMultiple(
    userIds: string[],
    title: string,
    body: string,
    data?: Record<string, string>,
    type: NotificationType = NotificationType.SYSTEM,
    category?: string,
  ): Promise<void> {
    // Persist all in-app notifications in bulk
    const docs = userIds.map((userId) => ({
      userId: new Types.ObjectId(userId),
      title,
      body,
      type,
      category: category || data?.type || null,
      data: data || {},
    }));

    try {
      await this.notificationModel.insertMany(docs, { ordered: false });
    } catch (err) {
      this.logger.error(`Failed to persist bulk notifications: ${err.message}`);
    }

    // Fetch all active tokens for these users in one query
    const tokens = await this.tokenModel.find({
      userId: { $in: userIds.map((id) => new Types.ObjectId(id)) },
      isActive: true,
    });

    if (tokens.length === 0) return;

    // Build Expo push messages
    const messages: any[] = [];
    for (const t of tokens) {
      if (!this.ExpoClass.isExpoPushToken(t.token)) {
        this.logger.warn(`Invalid Expo push token: ${t.token}`);
        continue;
      }
      messages.push({
        to: t.token,
        title,
        body,
        data: data || {},
        sound: 'default',
        priority: 'high',
      });
    }

    if (messages.length === 0) return;

    // Send in chunks
    const chunks = this.expo.chunkPushNotifications(messages);
    const invalidTokens: string[] = [];

    for (const chunk of chunks) {
      try {
        const tickets: any[] = await this.expo.sendPushNotificationsAsync(chunk);
        tickets.forEach((ticket, idx) => {
          if (ticket.status === 'error') {
            if (ticket.details?.error === 'DeviceNotRegistered') {
              invalidTokens.push((chunk[idx] as any).to as string);
            }
            this.logger.warn(`Push error: ${ticket.message}`);
          }
        });
      } catch (error) {
        this.logger.error(`Failed to send push chunk: ${error.message}`);
      }
    }

    // Clean up invalid tokens
    if (invalidTokens.length > 0) {
      await this.tokenModel.deleteMany({ token: { $in: invalidTokens } });
      this.logger.log(`Removed ${invalidTokens.length} invalid tokens`);
    }

    this.logger.log(`Broadcast push sent: ${messages.length} messages to ${userIds.length} users`);
  }

  /**
   * Send push notification to a single user via Expo Push API.
   */
  private async sendPush(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<void> {
    if (!this.expo) {
      this.logger.warn('Expo SDK not initialized yet, skipping push');
      return;
    }

    const tokens = await this.tokenModel.find({
      userId: new Types.ObjectId(userId),
      isActive: true,
    });

    if (tokens.length === 0) return;

    const messages: any[] = [];
    for (const t of tokens) {
      if (!this.ExpoClass.isExpoPushToken(t.token)) {
        this.logger.warn(`Invalid Expo push token: ${t.token}`);
        continue;
      }
      messages.push({
        to: t.token,
        title,
        body,
        data: data || {},
        sound: 'default',
        priority: 'high',
      });
    }

    if (messages.length === 0) return;

    const chunks = this.expo.chunkPushNotifications(messages);
    const invalidTokens: string[] = [];

    for (const chunk of chunks) {
      try {
        const tickets: any[] = await this.expo.sendPushNotificationsAsync(chunk);
        tickets.forEach((ticket, idx) => {
          if (ticket.status === 'error') {
            if (ticket.details?.error === 'DeviceNotRegistered') {
              invalidTokens.push((chunk[idx] as any).to as string);
            }
          }
        });
      } catch (error) {
        this.logger.error(`Failed to send push to user ${userId}: ${error.message}`);
      }
    }

    if (invalidTokens.length > 0) {
      await this.tokenModel.deleteMany({ token: { $in: invalidTokens } });
      this.logger.log(`Removed ${invalidTokens.length} invalid tokens`);
    }

    this.logger.log(`Push sent to user ${userId}: ${messages.length} device(s)`);
  }

  // ============================================
  // NOTIFICATION INBOX (User-facing queries)
  // ============================================

  async getUserNotifications(
    userId: string,
    query: { page?: number; limit?: number; type?: NotificationType; isRead?: boolean },
  ): Promise<PaginatedResult<UserNotification>> {
    const filter: any = { userId: new Types.ObjectId(userId) };
    if (query.type) filter.type = query.type;
    if (query.isRead !== undefined) filter.isRead = query.isRead;

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const total = await this.notificationModel.countDocuments(filter);
    const data = await this.notificationModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(calculateSkip(page, limit))
      .limit(limit);

    return paginate(data, total, page, limit);
  }

  async getUnreadCount(userId: string): Promise<number> {
    return this.notificationModel.countDocuments({
      userId: new Types.ObjectId(userId),
      isRead: false,
    });
  }

  async markAsRead(userId: string, notificationId: string): Promise<void> {
    await this.notificationModel.updateOne(
      { _id: notificationId, userId: new Types.ObjectId(userId) },
      { $set: { isRead: true } },
    );
  }

  async markAllAsRead(userId: string): Promise<void> {
    await this.notificationModel.updateMany(
      { userId: new Types.ObjectId(userId), isRead: false },
      { $set: { isRead: true } },
    );
  }

  // ============================================
  // ADMIN: BROADCAST + HISTORY
  // ============================================

  /**
   * Resolve target user IDs (and emails) for a broadcast.
   */
  private async resolveBroadcastTargets(
    recipients: BroadcastRecipientGroup,
    targetUserId: string | undefined,
    needEmails: boolean,
  ): Promise<{ ids: string[]; emails: string[] }> {
    if (recipients === BroadcastRecipientGroup.INDIVIDUAL) {
      if (!targetUserId) {
        throw new NotFoundException('targetUserId is required for individual broadcasts');
      }
      const user = await this.userModel
        .findById(targetUserId)
        .select(needEmails ? '_id email' : '_id')
        .lean();
      if (!user) {
        throw new NotFoundException('Target user not found');
      }
      return {
        ids: [(user._id as Types.ObjectId).toString()],
        emails: needEmails && user.email ? [user.email] : [],
      };
    }

    const filter: any = { isDeleted: { $ne: true } };
    if (recipients === BroadcastRecipientGroup.ACTIVE) {
      filter.status = UserStatus.ACTIVE;
    }

    const users = await this.userModel
      .find(filter)
      .select(needEmails ? '_id email' : '_id')
      .lean();

    return {
      ids: users.map((u) => (u._id as Types.ObjectId).toString()),
      emails: needEmails
        ? users
            .map((u) => u.email)
            .filter((e): e is string => typeof e === 'string' && e.length > 0)
        : [],
    };
  }

  /**
   * Send a broadcast (push or email) to all/active/individual users
   * and persist a log entry the admin can review.
   */
  async sendBroadcast(
    dto: {
      type: NotificationChannel;
      recipients: BroadcastRecipientGroup;
      subject: string;
      body: string;
      targetUserId?: string;
    },
    sentBy: string,
  ): Promise<{ sentCount: number; logId: string }> {
    const needEmails = dto.type === NotificationChannel.EMAIL;
    const { ids, emails } = await this.resolveBroadcastTargets(
      dto.recipients,
      dto.targetUserId,
      needEmails,
    );

    let sentCount = 0;
    let status: BroadcastStatus = BroadcastStatus.SENT;
    let errorMessage: string | null = null;

    try {
      if (dto.type === NotificationChannel.PUSH) {
        if (ids.length > 0) {
          await this.sendToMultiple(
            ids,
            dto.subject,
            dto.body,
            { source: 'admin_broadcast' },
            NotificationType.SYSTEM,
            'admin_broadcast',
          );
          sentCount = ids.length;
        }
      } else if (dto.type === NotificationChannel.EMAIL) {
        const html = `<p>${escapeHtml(dto.body).replace(/\n/g, '<br/>')}</p>`;
        const results = await Promise.all(
          emails.map((to) =>
            this.emailService.send({
              to,
              subject: dto.subject,
              html,
              text: dto.body,
            }).catch((err) => {
              this.logger.warn(`Email failed for ${to}: ${err?.message ?? err}`);
              return false;
            }),
          ),
        );
        sentCount = results.filter(Boolean).length;
        if (sentCount === 0 && emails.length > 0) {
          status = BroadcastStatus.FAILED;
          errorMessage = 'All emails failed to send';
        } else if (sentCount < emails.length) {
          status = BroadcastStatus.PARTIAL;
        }
      }
    } catch (err: any) {
      this.logger.error(`Broadcast failed: ${err?.message ?? err}`);
      status = BroadcastStatus.FAILED;
      errorMessage = err?.message ?? 'Unknown error';
    }

    const log = await this.logModel.create({
      subject: dto.subject,
      body: dto.body,
      type: dto.type,
      recipients: dto.recipients,
      targetUserId: dto.targetUserId ? new Types.ObjectId(dto.targetUserId) : null,
      sentCount,
      status,
      sentBy: new Types.ObjectId(sentBy),
      errorMessage,
    });

    this.logger.log(
      `Broadcast ${log._id}: type=${dto.type} recipients=${dto.recipients} sent=${sentCount} status=${status}`,
    );

    return {
      sentCount,
      logId: (log._id as Types.ObjectId).toString(),
    };
  }

  /**
   * Admin: paginated list of past broadcasts.
   */
  async getNotificationHistory(query: {
    page?: number;
    limit?: number;
    type?: NotificationChannel;
    status?: BroadcastStatus;
  }): Promise<PaginatedResult<NotificationLog>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const filter: any = {};
    if (query.type) filter.type = query.type;
    if (query.status) filter.status = query.status;

    const total = await this.logModel.countDocuments(filter);
    const data = await this.logModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(calculateSkip(page, limit))
      .limit(limit)
      .populate('targetUserId', 'fullName email')
      .populate('sentBy', 'fullName email')
      .lean();

    return paginate(data as any, total, page, limit);
  }
}

/** Minimal HTML escaper for email body. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
