/**
 * NotificationLog Schema
 *
 * Persists every admin-initiated broadcast (push or email) for the
 * admin notifications history page.
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type NotificationLogDocument = NotificationLog & Document;

export enum NotificationChannel {
  PUSH = 'push',
  EMAIL = 'email',
}

export enum BroadcastRecipientGroup {
  ALL = 'all',
  ACTIVE = 'active',
  INDIVIDUAL = 'individual',
}

export enum BroadcastStatus {
  SENT = 'sent',
  FAILED = 'failed',
  PARTIAL = 'partial',
}

@Schema({
  timestamps: true,
  collection: 'notification_logs',
})
export class NotificationLog {
  @Prop({ type: String, required: true })
  subject: string;

  @Prop({ type: String, required: true })
  body: string;

  @Prop({
    type: String,
    enum: NotificationChannel,
    required: true,
    index: true,
  })
  type: NotificationChannel;

  @Prop({
    type: String,
    enum: BroadcastRecipientGroup,
    required: true,
    index: true,
  })
  recipients: BroadcastRecipientGroup;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  targetUserId: Types.ObjectId | null;

  @Prop({ type: Number, default: 0 })
  sentCount: number;

  @Prop({
    type: String,
    enum: BroadcastStatus,
    default: BroadcastStatus.SENT,
    index: true,
  })
  status: BroadcastStatus;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  sentBy: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  errorMessage: string | null;
}

export const NotificationLogSchema = SchemaFactory.createForClass(NotificationLog);

NotificationLogSchema.index({ createdAt: -1 });
