/**
 * Admin DTOs
 * Data Transfer Objects for admin operations
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsInt,
  IsPositive,
  IsOptional,
  IsEnum,
  IsMongoId,
  Min,
  Max,
  MinLength,
  MaxLength,
  IsDateString,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { PaginationDto } from '../../common/dto/pagination.dto';

// ============================================
// WALLET ADJUSTMENT DTOs
// ============================================

export enum AdjustmentType {
  CREDIT = 'CREDIT',
  DEBIT = 'DEBIT',
}

export class ManualWalletAdjustmentDto {
  @ApiProperty({ description: 'User ID' })
  @IsMongoId()
  userId: string;

  @ApiProperty({ description: 'Adjustment type', enum: AdjustmentType })
  @IsEnum(AdjustmentType)
  type: AdjustmentType;

  @ApiProperty({ description: 'Amount in Naira (will be converted to kobo)', example: 1000 })
  @IsNumber()
  @IsInt({ message: 'Amount must be a whole number' })
  @IsPositive({ message: 'Amount must be positive' })
  @Min(1)
  @Max(10000000) // Max 10 million Naira
  @Type(() => Number)
  amount: number;

  @ApiProperty({ description: 'Reason for adjustment' })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason: string;

  @ApiPropertyOptional({ description: 'Internal reference number' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  internalReference?: string;
}

// ============================================
// VTU ADMIN DTOs
// ============================================

export enum VtuTransactionType {
  AIRTIME = 'AIRTIME',
  DATA = 'DATA',
}

export class VtuQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by type', enum: VtuTransactionType })
  @IsOptional()
  @IsEnum(VtuTransactionType)
  type?: VtuTransactionType;

  @ApiPropertyOptional({ description: 'Filter by status' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Filter by user ID' })
  @IsOptional()
  @IsMongoId()
  userId?: string;

  @ApiPropertyOptional({ description: 'Filter by network' })
  @IsOptional()
  @IsString()
  network?: string;

  @ApiPropertyOptional({ description: 'Search by reference or phone' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Start date filter' })
  @IsOptional()
  @Transform(({ value }) => new Date(value))
  startDate?: Date;

  @ApiPropertyOptional({ description: 'End date filter' })
  @IsOptional()
  @Transform(({ value }) => new Date(value))
  endDate?: Date;
}

export class ManualVtuRefundDto {
  @ApiProperty({ description: 'Reason for manual refund' })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason: string;
}

export class ManualVtuRetryDto {
  @ApiPropertyOptional({ description: 'Notes for retry attempt' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

// ============================================
// USER ADMIN DTOs
// ============================================

export enum UserStatusFilter {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  DELETED = 'DELETED',
}

export class UsersQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by status', enum: UserStatusFilter })
  @IsOptional()
  @IsEnum(UserStatusFilter)
  status?: UserStatusFilter;

  @ApiPropertyOptional({ description: 'Filter by email verified status' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  isEmailVerified?: boolean;

  @ApiPropertyOptional({ description: 'Filter by PIN set status' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  hasPinSet?: boolean;

  @ApiPropertyOptional({ description: 'Search by email, phone, or name' })
  @IsOptional()
  @IsString()
  search?: string;
}

export class UpdateUserStatusDto {
  @ApiProperty({ description: 'New status', enum: ['ACTIVE', 'SUSPENDED'] })
  @IsEnum(['ACTIVE', 'SUSPENDED'])
  status: 'ACTIVE' | 'SUSPENDED';

  @ApiProperty({ description: 'Reason for status change' })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason: string;
}

export class UpdateUserDetailsDto {
  @ApiPropertyOptional({ description: 'Full name' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  fullName?: string;

  @ApiPropertyOptional({ description: 'Email address' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  email?: string;

  @ApiPropertyOptional({ description: 'Phone number' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({ description: 'User status', enum: ['ACTIVE', 'SUSPENDED', 'DEACTIVATED'] })
  @IsOptional()
  @IsEnum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED'])
  status?: 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
}

// ============================================
// DASHBOARD DTOs
// ============================================

export class DashboardStatsResponse {
  @ApiProperty({ description: 'Total users count' })
  totalUsers: number;

  @ApiProperty({ description: 'Active users count' })
  activeUsers: number;

  @ApiProperty({ description: 'New users today' })
  newUsersToday: number;

  @ApiProperty({ description: 'Total wallet balance across all users (Naira)' })
  totalWalletBalance: number;

  @ApiProperty({ description: 'Pending gift card trades count' })
  pendingTrades: number;

  @ApiProperty({ description: 'Total trades today' })
  tradesToday: number;

  @ApiProperty({ description: 'Total VTU transactions today' })
  vtuToday: number;

  @ApiProperty({ description: 'Revenue today (Naira)' })
  revenueToday: number;
}

export class DateRangeDto {
  @ApiPropertyOptional({ description: 'Start date' })
  @IsOptional()
  @Transform(({ value }) => new Date(value))
  startDate?: Date;

  @ApiPropertyOptional({ description: 'End date' })
  @IsOptional()
  @Transform(({ value }) => new Date(value))
  endDate?: Date;
}

// ============================================
// PAYSTACK ADMIN DTOs
// ============================================

export class PaystackQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by status' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Filter by user ID' })
  @IsOptional()
  @IsMongoId()
  userId?: string;

  @ApiPropertyOptional({ description: 'Search by reference' })
  @IsOptional()
  @IsString()
  search?: string;
   @ApiPropertyOptional({
    description: 'Filter transactions from this date',
    example: '2024-01-01',
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({
    description: 'Filter transactions until this date',
    example: '2024-12-31',
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}
