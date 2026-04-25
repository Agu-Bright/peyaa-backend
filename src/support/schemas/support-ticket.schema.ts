/**
 * Support Ticket Schema
 * Represents a user's support ticket with messages
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type SupportTicketDocument = SupportTicket & Document;

export enum TicketCategory {
  GIFT_CARD = 'GIFT_CARD',
  VTU = 'VTU',
  ELECTRICITY = 'ELECTRICITY',
  WALLET = 'WALLET',
  WITHDRAWAL = 'WITHDRAWAL',
  ACCOUNT = 'ACCOUNT',
  GENERAL = 'GENERAL',
}

export enum TicketPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}

export enum TicketStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED',
}

export enum SenderType {
  USER = 'USER',
  ADMIN = 'ADMIN',
}

@Schema({ _id: false, timestamps: false })
export class TicketMessage {
  @ApiProperty({ description: 'Sender user ID' })
  @Prop({ type: Types.ObjectId, required: true })
  senderId: Types.ObjectId;

  @ApiProperty({ description: 'Sender type', enum: SenderType })
  @Prop({ type: String, enum: SenderType, required: true })
  senderType: SenderType;

  @ApiProperty({ description: 'Sender display name' })
  @Prop({ type: String, required: true })
  senderName: string;

  @ApiProperty({ description: 'Message content' })
  @Prop({ type: String, required: true })
  content: string;

  @ApiProperty({ description: 'Attachment URLs', type: [String] })
  @Prop({ type: [String], default: [] })
  attachments: string[];

  @ApiProperty({ description: 'Internal note (visible to admins only)', default: false })
  @Prop({ type: Boolean, default: false })
  isInternal: boolean;

  @ApiProperty({ description: 'Message creation timestamp' })
  @Prop({ type: Date, default: Date.now })
  createdAt: Date;
}

export const TicketMessageSchema = SchemaFactory.createForClass(TicketMessage);

@Schema({
  timestamps: true,
  collection: 'support_tickets',
  toJSON: {
    virtuals: true,
    transform: (_, ret: Record<string, any>) => {
      ret.id = ret._id;
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
})
export class SupportTicket {
  @ApiProperty({ description: 'Unique ticket number', example: 'TKT-A1B2C3' })
  @Prop({ type: String, required: true, unique: true, index: true })
  ticketNumber: string;

  @ApiProperty({ description: 'Reference to user' })
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @ApiProperty({ description: 'Ticket category', enum: TicketCategory })
  @Prop({ type: String, enum: TicketCategory, required: true })
  category: TicketCategory;

  @ApiProperty({ description: 'Ticket subject' })
  @Prop({ type: String, required: true })
  subject: string;

  @ApiProperty({ description: 'Ticket description' })
  @Prop({ type: String, required: true })
  description: string;

  @ApiProperty({ description: 'Ticket priority', enum: TicketPriority })
  @Prop({ type: String, enum: TicketPriority, default: TicketPriority.MEDIUM })
  priority: TicketPriority;

  @ApiProperty({ description: 'Ticket status', enum: TicketStatus })
  @Prop({ type: String, enum: TicketStatus, default: TicketStatus.OPEN })
  status: TicketStatus;

  @ApiProperty({ description: 'Ticket messages', type: [TicketMessage] })
  @Prop({ type: [TicketMessageSchema], default: [] })
  messages: TicketMessage[];

  @ApiProperty({ description: 'Attachment URLs', type: [String] })
  @Prop({ type: [String], default: [] })
  attachments: string[];

  @ApiPropertyOptional({ description: 'Resolved timestamp' })
  @Prop({ type: Date, default: null })
  resolvedAt: Date | null;

  @ApiPropertyOptional({ description: 'Closed timestamp' })
  @Prop({ type: Date, default: null })
  closedAt: Date | null;

  @ApiProperty({ description: 'Creation timestamp' })
  createdAt: Date;

  @ApiProperty({ description: 'Last update timestamp' })
  updatedAt: Date;
}

export const SupportTicketSchema = SchemaFactory.createForClass(SupportTicket);

// Compound indexes for efficient queries
SupportTicketSchema.index({ userId: 1, status: 1, createdAt: -1 });
SupportTicketSchema.index({ status: 1, priority: 1, createdAt: -1 });

// Text index for searching
SupportTicketSchema.index({ subject: 'text', ticketNumber: 'text', description: 'text' });
