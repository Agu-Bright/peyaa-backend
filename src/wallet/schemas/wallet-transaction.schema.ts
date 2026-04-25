/**
 * src/wallet/schemas/wallet-transaction.schema.ts
 *
 * Mongoose schema for wallet transactions (immutable ledger)
 *
 * NOTE: Add 'ELECTRICITY' to the TransactionCategory enum
 */
import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, Types } from "mongoose";

export type WalletTransactionDocument = WalletTransaction & Document;

export enum TransactionType {
  CREDIT = "CREDIT",
  DEBIT = "DEBIT",
}

export enum TransactionCategory {
  GIFTCARD = "GIFTCARD",
  AIRTIME = "AIRTIME",
  DATA = "DATA",
  ELECTRICITY = "ELECTRICITY",
  TV_SUBSCRIPTION = "TV_SUBSCRIPTION",
  TOPUP = "TOPUP",
  WITHDRAWAL = "WITHDRAWAL",
  MANUAL = "MANUAL",
  REFUND = "REFUND",
}

export enum TransactionSource {
  GIFTCARD_TRADE = "GIFTCARD_TRADE",
  VTU_SQUADCO = "VTU_SQUADCO",
  VTU_VTPASS = "VTU_VTPASS",
  PAYSTACK_TOPUP = "PAYSTACK_TOPUP",
  MANUAL_ADJUSTMENT = "MANUAL_ADJUSTMENT",
  REFUND = "REFUND",
}

export enum TransactionStatus {
  PENDING = "PENDING",
  SUCCESS = "SUCCESS",
  FAILED = "FAILED",
}

@Schema({
  timestamps: true,
  collection: "wallet_transactions",
})
export class WalletTransaction {
  @Prop({ type: Types.ObjectId, ref: "User", required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: "Wallet", required: true, index: true })
  walletId: Types.ObjectId;

  @Prop({ required: true, enum: TransactionType })
  type: TransactionType;

  @Prop({ required: true, enum: TransactionCategory })
  category: TransactionCategory;

  @Prop({ required: true, enum: TransactionSource })
  source: TransactionSource;

  @Prop({ required: true })
  amount: number; // Amount in kobo

  @Prop({ default: "NGN" })
  currency: string;

  @Prop({ required: true, unique: true, index: true })
  reference: string;

  @Prop({
    required: true,
    enum: TransactionStatus,
    default: TransactionStatus.PENDING,
  })
  status: TransactionStatus;

  @Prop()
  narration: string;

  @Prop({ type: Object })
  meta: Record<string, any>;

  @Prop()
  balanceBefore: number;

  @Prop()
  balanceAfter: number;

  createdAt: Date;
  updatedAt: Date;
}

export const WalletTransactionSchema =
  SchemaFactory.createForClass(WalletTransaction);

// Indexes
WalletTransactionSchema.index({ userId: 1, createdAt: -1 });
WalletTransactionSchema.index({ walletId: 1, createdAt: -1 });
WalletTransactionSchema.index({ status: 1 });
WalletTransactionSchema.index({ category: 1 });
