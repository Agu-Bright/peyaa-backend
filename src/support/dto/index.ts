/**
 * Support Ticket DTOs
 * Data Transfer Objects for support ticket operations
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsEnum,
  IsArray,
  IsUrl,
  IsBoolean,
  MinLength,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  TicketCategory,
  TicketPriority,
  TicketStatus,
} from '../schemas/support-ticket.schema';
import { PaginationDto } from '../../common/dto/pagination.dto';

// ============================================
// USER DTOs
// ============================================

export class CreateTicketDto {
  @ApiProperty({ description: 'Ticket category', enum: TicketCategory })
  @IsEnum(TicketCategory)
  category: TicketCategory;

  @ApiProperty({ description: 'Ticket subject', example: 'Issue with gift card trade' })
  @IsString()
  @MinLength(5)
  @MaxLength(200)
  subject: string;

  @ApiProperty({ description: 'Ticket description', example: 'My gift card trade has been pending for 24 hours...' })
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  description: string;

  @ApiPropertyOptional({ description: 'Ticket priority', enum: TicketPriority, default: TicketPriority.MEDIUM })
  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @ApiPropertyOptional({ description: 'Attachment URLs', type: [String] })
  @IsOptional()
  @IsArray()
  @IsUrl({}, { each: true })
  attachments?: string[];
}

export class ReplyTicketDto {
  @ApiProperty({ description: 'Reply message content' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content: string;

  @ApiPropertyOptional({ description: 'Attachment URLs', type: [String] })
  @IsOptional()
  @IsArray()
  @IsUrl({}, { each: true })
  attachments?: string[];
}

export class AdminReplyTicketDto extends ReplyTicketDto {
  @ApiPropertyOptional({ description: 'Internal note (visible to admins only)', default: false })
  @IsOptional()
  @IsBoolean()
  isInternal?: boolean;
}

export class UpdateTicketStatusDto {
  @ApiProperty({ description: 'New ticket status', enum: TicketStatus })
  @IsEnum(TicketStatus)
  status: TicketStatus;
}

// ============================================
// QUERY DTOs
// ============================================

export class TicketQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by status', enum: TicketStatus })
  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;
}

export class AdminTicketQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by status', enum: TicketStatus })
  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;

  @ApiPropertyOptional({ description: 'Filter by category', enum: TicketCategory })
  @IsOptional()
  @IsEnum(TicketCategory)
  category?: TicketCategory;

  @ApiPropertyOptional({ description: 'Filter by priority', enum: TicketPriority })
  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @ApiPropertyOptional({ description: 'Search by subject, ticket number, or description' })
  @IsOptional()
  @IsString()
  search?: string;
}
