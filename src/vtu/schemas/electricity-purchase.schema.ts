/**
 * src/vtu/schemas/electricity-purchase.schema.ts
 *
 * Mongoose schema for electricity purchases
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ElectricityPurchaseDocument = ElectricityPurchase & Document;

export enum MeterType {
  PREPAID = 'prepaid',
  POSTPAID = 'postpaid',
}

export enum ElectricityPurchaseStatus {
  PENDING = 'PENDING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
}

@Schema({ timestamps: true })
export class ElectricityPurchase {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  provider: string;

  @Prop({ required: true })
  providerName: string;

  @Prop({ required: true })
  meterNumber: string;

  @Prop({ required: true, enum: MeterType })
  meterType: MeterType;

  @Prop({ required: true })
  customerName: string;

  @Prop()
  customerAddress: string;

  @Prop({ required: true })
  phoneNumber: string;

  @Prop({ required: true })
  email: string;

  @Prop({ required: true })
  amount: number; // Amount in Naira

  @Prop()
  token: string; // Electricity token received

  @Prop()
  units: string; // Units purchased (e.g., "332.35 kWh")

  @Prop({ required: true, unique: true, index: true })
  reference: string; // Our internal reference

  @Prop()
  providerReference: string; // Reference from SquadCo lookup

  @Prop({
    required: true,
    enum: ElectricityPurchaseStatus,
    default: ElectricityPurchaseStatus.PENDING,
  })
  status: ElectricityPurchaseStatus;

  @Prop({ type: Types.ObjectId, ref: 'WalletTransaction' })
  walletTransactionId: Types.ObjectId;

  @Prop({ type: Object })
  providerResponse: Record<string, any>;

  @Prop({ type: Object })
  meterLookupData: Record<string, any>;

  @Prop()
  exchangeReference: string;

  @Prop()
  tariff: string;

  @Prop({ type: Number })
  tokenAmount: number;

  @Prop()
  utilityName: string;

  @Prop({ type: Number })
  balance: number;

  @Prop()
  resetToken: string;

  @Prop()
  configureToken: string;

  @Prop()
  failureReason: string;

  @Prop()
  refundedAt: Date;

  @Prop()
  refundReason: string;

  createdAt: Date;
  updatedAt: Date;
}

export const ElectricityPurchaseSchema = SchemaFactory.createForClass(ElectricityPurchase);

// Indexes
ElectricityPurchaseSchema.index({ userId: 1, createdAt: -1 });
ElectricityPurchaseSchema.index({ status: 1 });
ElectricityPurchaseSchema.index({ meterNumber: 1 });
ElectricityPurchaseSchema.index({ provider: 1 });