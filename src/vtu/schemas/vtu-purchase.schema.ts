/**
 * VTU Purchase Schemas
 *
 * Stores airtime and data purchase records.
 */
import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, Types, Schema as MongooseSchema } from "mongoose";

export type AirtimePurchaseDocument = AirtimePurchase & Document;
export type DataPurchaseDocument = DataPurchase & Document;

// Supported networks
export enum VtuNetwork {
  MTN = "MTN",
  GLO = "GLO",
  AIRTEL = "AIRTEL",
  ETISALAT = "9MOBILE",
}

export enum VtuPurchaseStatus {
  PENDING = "PENDING",
  SUCCESS = "SUCCESS",
  FAILED = "FAILED",
  REFUNDED = "REFUNDED",
}

// Alias for backward compatibility
export const VtuStatus = VtuPurchaseStatus;

// =====================
// Airtime Purchase
// =====================

@Schema({
  timestamps: true,
  collection: "airtime_purchases",
})
export class AirtimePurchase {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: "User", required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: String, required: true, enum: Object.values(VtuNetwork) })
  network: VtuNetwork;

  @Prop({ type: String, required: true })
  phoneNumber: string;

  @Prop({ type: Number, required: true })
  amount: number; // In Naira

  @Prop({ type: String, required: true, unique: true, index: true })
  reference: string;

  @Prop({ type: Types.ObjectId, ref: "WalletTransaction" })
  walletTransactionId?: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(VtuPurchaseStatus),
    default: VtuPurchaseStatus.PENDING,
  })
  status: VtuPurchaseStatus;

  @Prop({ type: String })
  providerReference?: string;

  @Prop({ type: MongooseSchema.Types.Mixed })
  providerResponse?: Record<string, any>;

  @Prop({ type: String })
  failureReason?: string;

  @Prop({ type: Date })
  refundedAt?: Date;

  @Prop({ type: String })
  refundReason?: string;

  createdAt: Date;
  updatedAt: Date;
}

export const AirtimePurchaseSchema =
  SchemaFactory.createForClass(AirtimePurchase);

// Indexes
AirtimePurchaseSchema.index({ userId: 1, createdAt: -1 });
AirtimePurchaseSchema.index({ status: 1 });
AirtimePurchaseSchema.index({ createdAt: -1 });

// =====================
// Data Purchase
// =====================

@Schema({
  timestamps: true,
  collection: "data_purchases",
})
export class DataPurchase {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: "User", required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: String, required: true, enum: Object.values(VtuNetwork) })
  network: VtuNetwork;

  @Prop({ type: String, required: true })
  phoneNumber: string;

  @Prop({ type: String, required: true })
  planCode: string;

  @Prop({ type: String, required: true })
  planName: string;

  @Prop({ type: Number, required: true })
  amount: number; // In Naira

  @Prop({ type: String, required: true, unique: true, index: true })
  reference: string;

  @Prop({ type: Types.ObjectId, ref: "WalletTransaction" })
  walletTransactionId?: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(VtuPurchaseStatus),
    default: VtuPurchaseStatus.PENDING,
  })
  status: VtuPurchaseStatus;

  @Prop({ type: String })
  providerReference?: string;

  @Prop({ type: MongooseSchema.Types.Mixed })
  providerResponse?: Record<string, any>;

  @Prop({ type: String })
  failureReason?: string;

  @Prop({ type: Date })
  refundedAt?: Date;

  @Prop({ type: String })
  refundReason?: string;

  @Prop()
  dataAmount?: string; // e.g., "1GB", "500MB"

  @Prop()
  validity?: string; // e.g., "30 days", "Weekly Plan"

  createdAt: Date;
  updatedAt: Date;
}

export const DataPurchaseSchema = SchemaFactory.createForClass(DataPurchase);

// Indexes
DataPurchaseSchema.index({ userId: 1, createdAt: -1 });
DataPurchaseSchema.index({ status: 1 });
DataPurchaseSchema.index({ createdAt: -1 });
