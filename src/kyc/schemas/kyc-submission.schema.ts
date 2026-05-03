/**
 * KycSubmission schema
 *
 * Stores every KYC upgrade attempt. A user may have multiple submissions
 * over time (e.g. one rejected, then a corrected resubmission).
 * The User document holds `latestKycSubmissionId` for fast lookup.
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type KycSubmissionDocument = KycSubmission & Document;

export enum KycSubmissionStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export enum KycIdType {
  DRIVERS_LICENSE = 'DRIVERS_LICENSE',
  INTERNATIONAL_PASSPORT = 'INTERNATIONAL_PASSPORT',
  VOTERS_CARD = 'VOTERS_CARD',
  NIN_SLIP = 'NIN_SLIP',
}

@Schema({ timestamps: true, collection: 'kyc_submissions' })
export class KycSubmission {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  // ─── Submitted details ───────────────────────────────
  /** 11-digit Bank Verification Number. */
  @Prop({ type: String, required: true })
  bvn: string;

  /** 11-digit National Identification Number. */
  @Prop({ type: String, required: true })
  nin: string;

  /** Date of birth as ISO date string YYYY-MM-DD. */
  @Prop({ type: String, required: true })
  dateOfBirth: string;

  /** Type of government-issued ID submitted. */
  @Prop({
    type: String,
    enum: Object.values(KycIdType),
    required: true,
  })
  idType: KycIdType;

  /** Cloudinary URL of the selfie photo. */
  @Prop({ type: String, required: true })
  selfieUrl: string;

  /** Cloudinary URL of the government ID photo. */
  @Prop({ type: String, required: true })
  idDocumentUrl: string;

  // ─── Review state ────────────────────────────────────
  @Prop({
    type: String,
    enum: Object.values(KycSubmissionStatus),
    default: KycSubmissionStatus.PENDING,
    index: true,
  })
  status: KycSubmissionStatus;

  /** When admin reviewed (approved/rejected). */
  @Prop({ type: Date, default: null })
  reviewedAt: Date | null;

  /** Admin user who reviewed it. */
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  reviewedBy: Types.ObjectId | null;

  /** Reason supplied by admin if rejected. */
  @Prop({ type: String, default: null })
  rejectionReason: string | null;

  /** Optional admin notes on approval (internal). */
  @Prop({ type: String, default: null })
  adminNotes: string | null;

  createdAt: Date;
  updatedAt: Date;
}

export const KycSubmissionSchema = SchemaFactory.createForClass(KycSubmission);

// Indexes for the admin queue: fast filter by status + recent first
KycSubmissionSchema.index({ status: 1, createdAt: -1 });
KycSubmissionSchema.index({ userId: 1, createdAt: -1 });
