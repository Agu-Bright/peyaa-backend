/**
 * TV Renewal Reminder Service
 *
 * Daily cron job that finds successful TV purchases expiring in ~3 days
 * and sends the user a reminder via push notification (with in-app inbox
 * row) plus email — pushing them to renew through Peyaa instead of
 * churning to a competitor.
 *
 * Idempotent: marks `reminderSentAt` after dispatch so subsequent cron
 * runs skip the same purchase.
 *
 * Suppression: purchases with `reminderSuperseded: true` are skipped
 * (set by the TV service when a newer purchase covers the same target).
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Cron } from '@nestjs/schedule';

import {
  TvPurchase,
  TvPurchaseDocument,
  TvPurchaseStatus,
} from './schemas/tv-subscription.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/schemas/user-notification.schema';
import { EmailService } from '../email/email.service';

const ONE_DAY_MS = 86_400_000;

@Injectable()
export class TvReminderService {
  private readonly logger = new Logger(TvReminderService.name);

  constructor(
    @InjectModel(TvPurchase.name)
    private readonly tvModel: Model<TvPurchaseDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly notificationsService: NotificationsService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Daily at 09:00 Africa/Lagos. Sends 3-day-out renewal reminders.
   *
   * Window: purchases expiring between (now + 3 days) and (now + 4 days).
   * One-day window catches every purchase exactly once across daily runs.
   */
  @Cron('0 9 * * *', { timeZone: 'Africa/Lagos' })
  async sendDueReminders(): Promise<void> {
    const startedAt = Date.now();
    const windowStart = new Date(startedAt + 3 * ONE_DAY_MS);
    const windowEnd = new Date(startedAt + 4 * ONE_DAY_MS);

    const due = await this.tvModel
      .find({
        status: TvPurchaseStatus.SUCCESS,
        expiresAt: { $gte: windowStart, $lt: windowEnd },
        reminderSentAt: null,
        reminderSuperseded: false,
      })
      .lean();

    if (due.length === 0) {
      this.logger.log('TV reminder sweep: no purchases due');
      return;
    }

    let sent = 0;
    let failed = 0;
    for (const purchase of due) {
      try {
        await this.sendReminderFor(purchase);
        sent++;
      } catch (err: any) {
        failed++;
        this.logger.error(
          `Reminder failed for purchase ${purchase._id}: ${err?.message ?? err}`,
        );
      }
    }

    this.logger.log(
      `TV reminder sweep complete: ${sent} sent, ${failed} failed (${due.length} due)`,
    );
  }

  /**
   * Send a single reminder (push + in-app + email) and mark `reminderSentAt`.
   * Public so it can be triggered manually for testing via an admin endpoint.
   */
  async sendReminderFor(purchase: TvPurchaseDocument | TvPurchase & { _id: any }): Promise<void> {
    const userIdStr = (purchase.userId as Types.ObjectId).toString();
    const purchaseIdStr = (purchase._id as Types.ObjectId).toString();

    const user = await this.userModel
      .findById(purchase.userId)
      .select('email fullName')
      .lean();
    if (!user) {
      this.logger.warn(`User ${userIdStr} not found for reminder ${purchaseIdStr}`);
      return;
    }

    const expiryDate = purchase.expiresAt
      ? new Date(purchase.expiresAt)
      : new Date(Date.now() + 3 * ONE_DAY_MS);
    const expiryDateStr = expiryDate.toLocaleDateString('en-NG', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

    const target = purchase.smartcardNumber || purchase.phoneNumber || '';
    const targetLabel = purchase.smartcardNumber ? `smartcard ${target}` : target;
    const bouquet = purchase.bouquetName || 'subscription';

    const title = `Your ${purchase.providerName} expires in 3 days`;
    const body = `Your ${bouquet} on ${targetLabel} ends ${expiryDateStr}. Tap to renew via Peyaa.`;

    // 1) Push + in-app inbox row (single call via existing infra)
    await this.notificationsService.sendToUser(
      userIdStr,
      title,
      body,
      {
        type: 'tv_renewal_reminder',
        tvPurchaseId: purchaseIdStr,
        provider: purchase.provider,
      },
      NotificationType.TRANSACTION,
      'tv_renewal',
    );

    // 2) Email (skipped if user has no email — Apple-Sign-In edge case)
    if (user.email) {
      try {
        await this.emailService.send({
          to: user.email,
          subject: title,
          html: this.buildEmailHtml({
            firstName: this.extractFirstName(user.fullName),
            providerName: purchase.providerName,
            bouquet,
            target: targetLabel,
            expiryDateStr,
          }),
          text: body,
        });
      } catch (err: any) {
        this.logger.warn(
          `Email reminder failed for ${user.email}: ${err?.message ?? err}`,
        );
      }
    }

    // 3) Mark sent (idempotency — guarantees no double-send on next cron tick)
    await this.tvModel.updateOne(
      { _id: purchase._id },
      { $set: { reminderSentAt: new Date() } },
    );

    this.logger.log(
      `TV renewal reminder sent: user=${userIdStr} purchase=${purchaseIdStr} provider=${purchase.provider}`,
    );
  }

  private extractFirstName(fullName?: string): string {
    if (!fullName) return 'there';
    return fullName.trim().split(/\s+/)[0] || 'there';
  }

  private buildEmailHtml(args: {
    firstName: string;
    providerName: string;
    bouquet: string;
    target: string;
    expiryDateStr: string;
  }): string {
    const { firstName, providerName, bouquet, target, expiryDateStr } = args;
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Your ${escape(providerName)} subscription expires in 3 days</title>
</head>
<body style="margin:0;padding:0;background:#F5F3FF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1E1B4B;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F3FF;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px rgba(91,33,182,0.08);">
          <tr>
            <td style="background:linear-gradient(135deg,#7C3AED 0%,#5B21B6 100%);padding:24px 28px;color:#FFFFFF;">
              <div style="font-size:20px;font-weight:800;letter-spacing:-0.3px;">Peyaa</div>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 28px 8px 28px;">
              <h1 style="margin:0 0 8px 0;font-size:22px;font-weight:800;color:#1E1B4B;line-height:1.3;">
                Your ${escape(providerName)} expires in 3 days
              </h1>
              <p style="margin:0;font-size:14px;color:#6B7280;line-height:1.5;">
                Hi ${escape(firstName)}, here's a heads-up so your TV doesn't go off.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F3FF;border-radius:12px;padding:16px;">
                <tr>
                  <td style="padding:8px 0;font-size:13px;color:#6B7280;">Plan</td>
                  <td style="padding:8px 0;font-size:13px;color:#1E1B4B;text-align:right;font-weight:600;">${escape(bouquet)}</td>
                </tr>
                <tr>
                  <td style="padding:8px 0;font-size:13px;color:#6B7280;">${purchaseTargetLabelKey(target)}</td>
                  <td style="padding:8px 0;font-size:13px;color:#1E1B4B;text-align:right;font-weight:600;font-family:'Courier New',monospace;">${escape(target)}</td>
                </tr>
                <tr>
                  <td style="padding:8px 0;font-size:13px;color:#6B7280;">Expires</td>
                  <td style="padding:8px 0;font-size:13px;color:#7C3AED;text-align:right;font-weight:700;">${escape(expiryDateStr)}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:8px 28px 32px 28px;">
              <a href="https://peyaa.com/app/tv" style="display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#7C3AED 0%,#5B21B6 100%);color:#FFFFFF;text-decoration:none;border-radius:12px;font-weight:700;font-size:15px;letter-spacing:0.2px;">
                Renew now
              </a>
              <p style="margin:14px 0 0 0;font-size:12px;color:#9CA3AF;">
                Open the Peyaa app to renew in seconds — paid straight from your wallet.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 28px;background:#FAFAFB;font-size:11px;color:#9CA3AF;text-align:center;">
              You're receiving this because you renewed your ${escape(providerName)} via Peyaa.<br/>
              &copy; ${new Date().getFullYear()} Peyaa. All rights reserved.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }
}

/** Minimal HTML escaper. */
function escape(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Choose the right label for the target field shown in the email. */
function purchaseTargetLabelKey(target: string): string {
  // Smartcard numbers from VTPass are typically 10–12 digits.
  // Phone numbers contain non-digits or are 11/14 chars starting with 0/234.
  if (/^\d{10,12}$/.test(target)) return 'Smartcard';
  return 'Phone';
}
