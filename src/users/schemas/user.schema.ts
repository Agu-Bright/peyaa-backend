/**
 * User Schema
 * 
 * Core user model with authentication fields.
 * Supports both email/password and social auth (Google/Apple).
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type UserDocument = User & Document;

export enum UserRole {
  USER = 'USER',
  ADMIN = 'ADMIN',
}

export enum UserStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  DEACTIVATED = 'DEACTIVATED',
}

/**
 * KYC tier — controls how high a user's wallet balance can go.
 *  - TIER_1 (default): cap at DEFAULT_TIER_1_LIMIT_KOBO (₦500K)
 *  - TIER_2: cap at admin-configurable limit (default ₦5M, see settings.service)
 */
export enum KycTier {
  TIER_1 = 'TIER_1',
  TIER_2 = 'TIER_2',
}

/**
 * KYC status for a user. NONE means they've never submitted.
 *  - NONE: never submitted
 *  - PENDING: submitted, awaiting admin review
 *  - APPROVED: admin approved → user is now Tier 2
 *  - REJECTED: admin rejected → user can resubmit
 */
export enum KycStatus {
  NONE = 'NONE',
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

/** Default Tier 1 wallet limit in kobo: ₦500,000.00 = 50,000,000 kobo. */
export const DEFAULT_TIER_1_LIMIT_KOBO = 50_000_000;
/** Default Tier 2 wallet limit in kobo (overridable in app settings): ₦5,000,000. */
export const DEFAULT_TIER_2_LIMIT_KOBO = 500_000_000;

@Schema({
  timestamps: true,
  collection: 'users',
})
export class User {
  /**
   * User's email address (unique, optional for Apple edge case)
   */
  @Prop({
    type: String,
    unique: true,
    sparse: true, // Allows multiple null values
    lowercase: true,
    trim: true,
    index: true,
  })
  email?: string;

  /**
   * User's phone number (unique, optional)
   */
  @Prop({
    type: String,
    unique: true,
    sparse: true,
    trim: true,
    index: true,
  })
  phone?: string;

  /**
   * Hashed password (nullable for social auth users)
   */
  @Prop({ type: String })
  passwordHash?: string;

  /**
   * Email verification status
   */
  @Prop({ type: Boolean, default: false, index: true })
  isEmailVerified: boolean;

  /**
   * User roles for authorization
   */
  @Prop({
    type: [String],
    enum: Object.values(UserRole),
    default: [UserRole.USER],
  })
  roles: UserRole[];

  /**
   * Hashed 4-digit transaction PIN
   */
  @Prop({ type: String })
  transactionPinHash?: string;

  /**
   * User's full name (from social auth or profile)
   */
  @Prop({ type: String, trim: true })
  fullName?: string;

  /**
   * User's avatar URL (from social auth)
   */
  @Prop({ type: String })
  avatarUrl?: string;

  /**
   * Hashed refresh token for token rotation
   * Only the latest refresh token hash is stored; old tokens are invalidated.
   */
  @Prop({ type: String })
  refreshTokenHash?: string;

  /**
   * Soft delete flag
   */
  @Prop({ type: Boolean, default: false })
  isDeleted: boolean;

  /**
   * Account status
   */
  @Prop({
    type: String,
    enum: Object.values(UserStatus),
    default: UserStatus.ACTIVE,
    index: true,
  })
  status: UserStatus;

  /**
   * Unique referral code for this user
   */
  @Prop({
    type: String,
    unique: true,
    sparse: true,
    index: true,
  })
  referralCode?: string;

  /**
   * The user who referred this user (if any)
   */
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  referredBy?: Types.ObjectId;

  // ─── KYC + wallet limit ────────────────────────────────
  /**
   * The user's current KYC tier. Drives the wallet balance cap.
   * New users default to TIER_1 (₦500,000).
   */
  @Prop({
    type: String,
    enum: Object.values(KycTier),
    default: KycTier.TIER_1,
    index: true,
  })
  kycTier: KycTier;

  /**
   * Wallet balance cap (in kobo). Top-ups that would push balance over
   * this value are rejected. Computed from `kycTier` at signup but can
   * be overridden per-user by an admin.
   */
  @Prop({
    type: Number,
    default: DEFAULT_TIER_1_LIMIT_KOBO,
  })
  walletLimit: number;

  /**
   * Status of the user's most-recent KYC submission. NONE if never submitted.
   */
  @Prop({
    type: String,
    enum: Object.values(KycStatus),
    default: KycStatus.NONE,
    index: true,
  })
  kycStatus: KycStatus;

  /**
   * Reference to the most-recent KycSubmission document for quick lookup.
   */
  @Prop({ type: Types.ObjectId, ref: 'KycSubmission', default: null })
  latestKycSubmissionId: Types.ObjectId | null;

  /**
   * Timestamps (auto-managed)
   */
  createdAt: Date;
  updatedAt: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);

// Indexes
UserSchema.index({ email: 1 }, { unique: true, sparse: true });
UserSchema.index({ phone: 1 }, { unique: true, sparse: true });
UserSchema.index({ createdAt: -1 });
UserSchema.index({ status: 1, isDeleted: 1 });

// Virtual for wallet (populated separately)
UserSchema.virtual('wallet', {
  ref: 'Wallet',
  localField: '_id',
  foreignField: 'userId',
  justOne: true,
});

// Exclude sensitive fields from JSON
UserSchema.set('toJSON', {
  transform: (doc, ret: Record<string, any>) => {
    delete ret.passwordHash;
    delete ret.transactionPinHash;
    delete ret.refreshTokenHash;
    delete ret.__v;
    return ret;
  },
});
