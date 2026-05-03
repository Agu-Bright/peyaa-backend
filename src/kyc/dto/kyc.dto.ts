/**
 * KYC DTOs — request/response shapes for both user-facing and admin endpoints.
 */
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  Matches,
  IsUrl,
  IsDateString,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { KycIdType, KycSubmissionStatus } from '../schemas/kyc-submission.schema';

/**
 * What a user POSTs to /kyc/submit.
 * Image fields are pre-uploaded URLs (selfieUrl, idDocumentUrl) — the mobile
 * app uploads to Cloudinary first via /uploads then submits the URLs here.
 */
export class SubmitKycDto {
  @ApiProperty({ example: '12345678901', description: '11-digit BVN' })
  @IsString()
  @Matches(/^\d{11}$/, { message: 'BVN must be exactly 11 digits' })
  bvn: string;

  @ApiProperty({ example: '12345678901', description: '11-digit NIN' })
  @IsString()
  @Matches(/^\d{11}$/, { message: 'NIN must be exactly 11 digits' })
  nin: string;

  @ApiProperty({ example: '1995-04-12', description: 'YYYY-MM-DD' })
  @IsDateString()
  dateOfBirth: string;

  @ApiProperty({ enum: KycIdType, example: KycIdType.NIN_SLIP })
  @IsEnum(KycIdType)
  idType: KycIdType;

  @ApiProperty({
    example: 'https://res.cloudinary.com/peyaa/image/upload/v123/selfie.jpg',
    description: 'Cloudinary URL of the selfie photo',
  })
  @IsString()
  @IsNotEmpty()
  selfieUrl: string;

  @ApiProperty({
    example: 'https://res.cloudinary.com/peyaa/image/upload/v123/id.jpg',
    description: 'Cloudinary URL of the government-ID photo',
  })
  @IsString()
  @IsNotEmpty()
  idDocumentUrl: string;
}

/**
 * What an admin POSTs to /admin/kyc/:id/reject.
 */
export class RejectKycDto {
  @ApiProperty({
    example: 'Selfie photo is too blurry — please retake in good lighting.',
    description: 'User-facing reason for rejection',
  })
  @IsString()
  @IsNotEmpty()
  reason: string;

  @ApiPropertyOptional({ description: 'Internal admin notes' })
  @IsOptional()
  @IsString()
  adminNotes?: string;
}

/**
 * What an admin POSTs to /admin/kyc/:id/approve.
 */
export class ApproveKycDto {
  @ApiPropertyOptional({ description: 'Internal admin notes' })
  @IsOptional()
  @IsString()
  adminNotes?: string;

  @ApiPropertyOptional({
    description:
      'Optional override of the Tier 2 wallet limit for this user (in kobo). Falls back to the global Tier 2 limit if omitted.',
    example: 500_000_000,
  })
  @IsOptional()
  @IsInt()
  @Min(50_000_000)
  @Max(10_000_000_000) // hard cap: ₦100M
  walletLimitOverride?: number;
}

/**
 * Query for the admin queue listing.
 */
export class AdminKycQueryDto {
  @ApiPropertyOptional({ enum: KycSubmissionStatus })
  @IsOptional()
  @IsEnum(KycSubmissionStatus)
  status?: KycSubmissionStatus;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

/**
 * What /kyc/status returns for a user. Used by mobile to render the
 * "Wallet limit / KYC tier" UI live.
 */
export interface KycStatusResponse {
  kycTier: 'TIER_1' | 'TIER_2';
  walletLimit: number;
  walletLimitNaira: number;
  kycStatus: 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';
  /** Most recent submission summary, if any. */
  latestSubmission: {
    id: string;
    status: KycSubmissionStatus;
    submittedAt: string;
    reviewedAt: string | null;
    rejectionReason: string | null;
  } | null;
  /** What the next-tier limit would be (helps the UI render "Upgrade to ₦5M"). */
  nextTierLimit: number;
  nextTierLimitNaira: number;
}
