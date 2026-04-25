/**
 * Support Service
 * Handles all support ticket related business logic
 */
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';
import { randomBytes } from 'crypto';
import {
  SupportTicket,
  SupportTicketDocument,
  TicketStatus,
  SenderType,
} from './schemas/support-ticket.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  CreateTicketDto,
  ReplyTicketDto,
  AdminReplyTicketDto,
  UpdateTicketStatusDto,
  TicketQueryDto,
  AdminTicketQueryDto,
} from './dto';
import { paginate, calculateSkip } from '../common/utils/helpers';
import { PaginatedResult } from '../common/dto/pagination.dto';

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    @InjectModel(SupportTicket.name)
    private readonly ticketModel: Model<SupportTicketDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  /**
   * Generate a unique ticket number (TKT- + 6 random uppercase alphanumeric chars)
   */
  private async generateTicketNumber(): Promise<string> {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let ticketNumber: string;
    let exists = true;

    while (exists) {
      const bytes = randomBytes(6);
      let result = 'TKT-';
      for (let i = 0; i < 6; i++) {
        result += chars[bytes[i] % chars.length];
      }
      ticketNumber = result;
      exists = !!(await this.ticketModel.findOne({ ticketNumber }));
    }

    return ticketNumber!;
  }

  /**
   * Get sender name from user document
   */
  private getSenderName(user: UserDocument): string {
    return user.fullName || user.email || 'Unknown User';
  }

  // ============================================
  // USER OPERATIONS
  // ============================================

  /**
   * Create a new support ticket
   */
  async createTicket(userId: string, dto: CreateTicketDto): Promise<SupportTicket> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const ticketNumber = await this.generateTicketNumber();
    const senderName = this.getSenderName(user);

    const ticket = new this.ticketModel({
      ticketNumber,
      userId: new Types.ObjectId(userId),
      category: dto.category,
      subject: dto.subject,
      description: dto.description,
      priority: dto.priority,
      attachments: dto.attachments || [],
      messages: [
        {
          senderId: new Types.ObjectId(userId),
          senderType: SenderType.USER,
          senderName,
          content: dto.description,
          attachments: dto.attachments || [],
          isInternal: false,
          createdAt: new Date(),
        },
      ],
    });

    const savedTicket = await ticket.save();

    this.logger.log(
      `Ticket created: ${ticketNumber} | User: ${userId} | Category: ${dto.category}`,
    );

    return savedTicket;
  }

  /**
   * Get current user's tickets (paginated)
   */
  async getMyTickets(
    userId: string,
    query: TicketQueryDto,
  ): Promise<PaginatedResult<SupportTicket>> {
    const filter: any = { userId: new Types.ObjectId(userId) };

    if (query.status) {
      filter.status = query.status;
    }

    const total = await this.ticketModel.countDocuments(filter);
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const tickets = await this.ticketModel
      .find(filter)
      .select('-messages')
      .sort({ createdAt: -1 })
      .skip(calculateSkip(page, limit))
      .limit(limit);

    return paginate(tickets, total, page, limit);
  }

  /**
   * Get a single ticket by ID (user-facing, filters out internal messages)
   */
  async getTicketById(ticketId: string, userId?: string): Promise<SupportTicket> {
    if (!isValidObjectId(ticketId)) {
      throw new BadRequestException('Invalid ticket ID');
    }

    const ticket = await this.ticketModel
      .findById(ticketId)
      .populate('userId', 'fullName email phone');

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    // Verify ownership if userId provided
    if (userId && ticket.userId.toString() !== userId) {
      throw new ForbiddenException('You do not have access to this ticket');
    }

    // Filter out internal messages for user requests
    if (userId) {
      ticket.messages = ticket.messages.filter((msg) => !msg.isInternal);
    }

    return ticket;
  }

  /**
   * User replies to a ticket
   */
  async userReply(
    ticketId: string,
    userId: string,
    dto: ReplyTicketDto,
  ): Promise<SupportTicket> {
    if (!isValidObjectId(ticketId)) {
      throw new BadRequestException('Invalid ticket ID');
    }

    const ticket = await this.ticketModel.findOne({
      _id: ticketId,
      userId: new Types.ObjectId(userId),
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    if (ticket.status === TicketStatus.CLOSED) {
      throw new ConflictException('Cannot reply to a closed ticket');
    }

    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const senderName = this.getSenderName(user);

    ticket.messages.push({
      senderId: new Types.ObjectId(userId),
      senderType: SenderType.USER,
      senderName,
      content: dto.content,
      attachments: dto.attachments || [],
      isInternal: false,
      createdAt: new Date(),
    } as any);

    // If ticket was resolved, reopen it
    if (ticket.status === TicketStatus.RESOLVED) {
      ticket.status = TicketStatus.OPEN;
    }

    await ticket.save();

    // Strip internal messages before returning
    ticket.messages = ticket.messages.filter((msg) => !msg.isInternal);

    this.logger.log(`User replied to ticket: ${ticket.ticketNumber}`);

    return ticket;
  }

  /**
   * User closes a ticket
   */
  async closeTicket(ticketId: string, userId: string): Promise<SupportTicket> {
    if (!isValidObjectId(ticketId)) {
      throw new BadRequestException('Invalid ticket ID');
    }

    const ticket = await this.ticketModel.findOne({
      _id: ticketId,
      userId: new Types.ObjectId(userId),
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    ticket.status = TicketStatus.CLOSED;
    ticket.closedAt = new Date();

    if (!ticket.resolvedAt) {
      ticket.resolvedAt = new Date();
    }

    await ticket.save();

    this.logger.log(`Ticket closed by user: ${ticket.ticketNumber}`);

    return ticket;
  }

  // ============================================
  // ADMIN OPERATIONS
  // ============================================

  /**
   * Admin gets all tickets (paginated with filters)
   */
  async adminGetTickets(
    query: AdminTicketQueryDto,
  ): Promise<PaginatedResult<SupportTicket>> {
    const filter: any = {};

    if (query.status) {
      filter.status = query.status;
    }

    if (query.category) {
      filter.category = query.category;
    }

    if (query.priority) {
      filter.priority = query.priority;
    }

    if (query.search) {
      filter.$or = [
        { subject: { $regex: query.search, $options: 'i' } },
        { ticketNumber: { $regex: query.search, $options: 'i' } },
        { description: { $regex: query.search, $options: 'i' } },
      ];
    }

    const total = await this.ticketModel.countDocuments(filter);
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const tickets = await this.ticketModel
      .find(filter)
      .populate('userId', 'fullName email phone')
      .select('-messages')
      .sort({ createdAt: -1 })
      .skip(calculateSkip(page, limit))
      .limit(limit);

    return paginate(tickets, total, page, limit);
  }

  /**
   * Admin gets ticket statistics
   */
  async adminGetTicketStats(): Promise<any> {
    const byStatus = await this.ticketModel.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
    ]);

    const byPriority = await this.ticketModel.aggregate([
      {
        $group: {
          _id: '$priority',
          count: { $sum: 1 },
        },
      },
    ]);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const totalToday = await this.ticketModel.countDocuments({
      createdAt: { $gte: today },
    });

    const total = await this.ticketModel.countDocuments();

    return {
      byStatus,
      byPriority,
      totalToday,
      total,
    };
  }

  /**
   * Admin gets a single ticket by ID (includes internal messages)
   */
  async adminGetTicketById(ticketId: string): Promise<SupportTicket> {
    if (!isValidObjectId(ticketId)) {
      throw new BadRequestException('Invalid ticket ID');
    }

    const ticket = await this.ticketModel
      .findById(ticketId)
      .populate('userId', 'fullName email phone');

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    return ticket;
  }

  /**
   * Admin replies to a ticket
   */
  async adminReply(
    ticketId: string,
    adminId: string,
    dto: AdminReplyTicketDto,
  ): Promise<SupportTicket> {
    if (!isValidObjectId(ticketId)) {
      throw new BadRequestException('Invalid ticket ID');
    }

    const ticket = await this.ticketModel.findById(ticketId);
    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    const admin = await this.userModel.findById(adminId);
    if (!admin) {
      throw new NotFoundException('Admin user not found');
    }

    const senderName = this.getSenderName(admin);
    const isInternal = dto.isInternal || false;

    ticket.messages.push({
      senderId: new Types.ObjectId(adminId),
      senderType: SenderType.ADMIN,
      senderName,
      content: dto.content,
      attachments: dto.attachments || [],
      isInternal,
      createdAt: new Date(),
    } as any);

    // If not internal and status is OPEN, set to IN_PROGRESS
    if (!isInternal && ticket.status === TicketStatus.OPEN) {
      ticket.status = TicketStatus.IN_PROGRESS;
    }

    await ticket.save();

    this.logger.log(
      `Admin replied to ticket: ${ticket.ticketNumber} | Internal: ${isInternal}`,
    );

    return ticket;
  }

  /**
   * Admin updates ticket status
   */
  async adminUpdateStatus(
    ticketId: string,
    dto: UpdateTicketStatusDto,
  ): Promise<SupportTicket> {
    if (!isValidObjectId(ticketId)) {
      throw new BadRequestException('Invalid ticket ID');
    }

    const ticket = await this.ticketModel.findById(ticketId);
    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    ticket.status = dto.status;

    if (dto.status === TicketStatus.RESOLVED) {
      ticket.resolvedAt = new Date();
    }

    if (dto.status === TicketStatus.CLOSED) {
      ticket.closedAt = new Date();
      if (!ticket.resolvedAt) {
        ticket.resolvedAt = new Date();
      }
    }

    await ticket.save();

    this.logger.log(
      `Ticket status updated: ${ticket.ticketNumber} | Status: ${dto.status}`,
    );

    return ticket;
  }
}
