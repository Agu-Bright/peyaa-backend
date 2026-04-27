/**
 * TV Purchase Schema
 * Stores TV subscription purchase records (DSTV, GOtv, StarTimes, Showmax)
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum TvProvider {
  DSTV = 'dstv',
  GOTV = 'gotv',
  STARTIMES = 'startimes',
  SHOWMAX = 'showmax',
}

export enum TvSubscriptionType {
  CHANGE = 'change',
  RENEW = 'renew',
}

export enum TvPurchaseStatus {
  PENDING = 'PENDING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
}

export type TvPurchaseDocument = TvPurchase & Document;

@Schema({ timestamps: true, collection: 'tv_purchases' })
export class TvPurchase {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(TvProvider), required: true })
  provider: TvProvider;

  @Prop({ type: String, required: true })
  providerName: string;

  @Prop({ type: String, index: true })
  smartcardNumber: string;

  @Prop({ type: String })
  customerName: string;

  @Prop({ type: String })
  bouquetCode: string;

  @Prop({ type: String })
  bouquetName: string;

  @Prop({ type: String, enum: Object.values(TvSubscriptionType) })
  subscriptionType: TvSubscriptionType;

  @Prop({ type: Number, required: true })
  amount: number;

  @Prop({ type: Number })
  quantity: number;

  @Prop({ type: String })
  phoneNumber: string;

  @Prop({ type: String, unique: true, required: true, index: true })
  reference: string;

  @Prop({ type: String })
  requestId: string;

  @Prop({
    type: String,
    enum: Object.values(TvPurchaseStatus),
    default: TvPurchaseStatus.PENDING,
    index: true,
  })
  status: TvPurchaseStatus;

  @Prop({ type: Types.ObjectId, ref: 'WalletTransaction' })
  walletTransactionId: Types.ObjectId;

  @Prop({ type: String })
  providerReference: string;

  @Prop({ type: Object })
  providerResponse: Record<string, any>;

  @Prop({ type: String })
  failureReason: string;

  @Prop({ type: Date })
  refundedAt: Date;

  @Prop({ type: String })
  refundReason: string;

  // ── Renewal-reminder tracking ─────────────────────────────
  /** When this subscription is expected to expire. Calculated as createdAt + (quantity || 1) * 30 days on successful purchase. Null for failed/refunded purchases. */
  @Prop({ type: Date, default: null, index: true })
  expiresAt: Date | null;

  /** Set when the 3-day-out renewal reminder has been dispatched. Prevents duplicate reminders on subsequent cron runs. */
  @Prop({ type: Date, default: null })
  reminderSentAt: Date | null;

  /** Set true when a newer successful purchase covers the same target (smartcard or phone). The cron skips superseded purchases so users don't get reminded after they've already renewed. */
  @Prop({ type: Boolean, default: false, index: true })
  reminderSuperseded: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export const TvPurchaseSchema = SchemaFactory.createForClass(TvPurchase);

// Indexes
TvPurchaseSchema.index({ userId: 1, createdAt: -1 });
TvPurchaseSchema.index({ status: 1 });
TvPurchaseSchema.index({ provider: 1 });
TvPurchaseSchema.index({ createdAt: -1 });

// Compound index for the reminder cron: indexed scan over a tiny 24-hour expiry window.
TvPurchaseSchema.index({
  status: 1,
  expiresAt: 1,
  reminderSentAt: 1,
  reminderSuperseded: 1,
});
