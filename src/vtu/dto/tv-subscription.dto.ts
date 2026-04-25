/**
 * TV Subscription DTOs
 *
 * Supports provider-specific flows:
 * - DStv/GOtv: smartcard verify → change (variation_code) or renew (renewalAmount)
 * - StarTimes: smartcard verify → variation_code only (no subscription_type)
 * - Showmax: phone-based (no smartcard verify), variation_code only
 */
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsEnum,
  Min,
  Max,
  IsInt,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { TvProvider, TvSubscriptionType } from '../schemas/tv-subscription.schema';

export class VerifySmartcardDto {
  @ApiProperty({ description: 'Smartcard/decoder number', example: '1212121212' })
  @IsString()
  @IsNotEmpty()
  smartcardNumber: string;

  @ApiProperty({ description: 'TV provider', enum: TvProvider, example: 'dstv' })
  @IsEnum(TvProvider)
  provider: TvProvider;
}

export class GetBouquetsDto {
  @ApiProperty({ description: 'TV provider', enum: TvProvider, example: 'dstv' })
  @IsEnum(TvProvider)
  provider: TvProvider;
}

export class PurchaseTvDto {
  @ApiPropertyOptional({
    description: 'Smartcard/decoder number (required for DStv/GOtv/StarTimes, not for Showmax)',
    example: '1212121212',
  })
  @IsString()
  @IsOptional()
  smartcardNumber?: string;

  @ApiProperty({ description: 'TV provider', enum: TvProvider, example: 'dstv' })
  @IsEnum(TvProvider)
  provider: TvProvider;

  @ApiPropertyOptional({
    description: 'Bouquet/plan code (required for change/StarTimes/Showmax, not for DStv/GOtv renew)',
    example: 'dstv-padi',
  })
  @IsString()
  @IsOptional()
  bouquetCode?: string;

  @ApiPropertyOptional({ description: 'Bouquet name for display', example: 'DStv Padi' })
  @IsString()
  @IsOptional()
  bouquetName?: string;

  @ApiPropertyOptional({
    description: 'Subscription type (only for DStv/GOtv: "change" or "renew")',
    enum: TvSubscriptionType,
    example: 'change',
  })
  @IsEnum(TvSubscriptionType)
  @IsOptional()
  subscriptionType?: TvSubscriptionType;

  @ApiProperty({ description: 'Amount in Naira', example: 2150 })
  @IsNumber()
  @Min(100)
  @Max(500000)
  @Type(() => Number)
  amount: number;

  @ApiProperty({ description: 'Phone number for notification', example: '08011111111' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^(0[789][01]\d{8}|234[789][01]\d{8}|\+234[789][01]\d{8})$/, {
    message: 'Invalid Nigerian phone number',
  })
  phone: string;

  @ApiPropertyOptional({ description: 'Customer name from verification', example: 'JOHN DOE' })
  @IsString()
  @IsOptional()
  customerName?: string;

  @ApiPropertyOptional({ description: 'Number of months (DStv/GOtv only)', example: 1 })
  @IsNumber()
  @IsInt()
  @Min(1)
  @Max(12)
  @IsOptional()
  @Type(() => Number)
  quantity?: number;
}

export class GetTvPurchasesDto {
  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  page?: number;

  @ApiPropertyOptional({ description: 'Items per page', default: 20 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number;

  @ApiPropertyOptional({ description: 'Filter by status' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Filter by provider', enum: TvProvider })
  @IsOptional()
  @IsEnum(TvProvider)
  provider?: TvProvider;
}
