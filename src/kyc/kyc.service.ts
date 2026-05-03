/**
 * KYC service — handles user submissions and admin reviews.
 *
 * Flow:
 *   1. User uploads photos via /uploads then POSTs URLs + details to /kyc/submit.
 *   2. KycSubmission row created with PENDING status; user.kycStatus=PENDING.
 *   3. Admin sees it in the queue, calls approve or reject.
 *   4. On approve: user.kycTier=TIER_2, user.walletLimit bumped, push+email.
 *   5. On reject: user.kycStatus=REJECTED, user keeps current limit, push+email.
 *
 * The mobile app's notification handler invalidates the user/profile React
 * Query cache when a KYC notification arrives, giving the live update.
 */
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import {
  KycSubmission,
  KycSubmissionDocument,
  KycSubmissionStatus,
} from './schemas/kyc-submission.schema';
import {
  User,
  UserDocument,
  KycTier,
  KycStatus,
  DEFAULT_TIER_2_LIMIT_KOBO,
} from '../users/schemas/user.schema';
import {
  SubmitKycDto,
  AdminKycQueryDto,
  ApproveKycDto,
  RejectKycDto,
  KycStatusResponse,
} from './dto/kyc.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/schemas/user-notification.schema';
import { EmailService } from '../email/email.service';
import { paginate, calculateSkip } from '../common/utils/helpers';
import { PaginatedResult } from '../common/dto/pagination.dto';

@Injectable()
export class KycService {
  private readonly logger = new Logger(KycService.name);

  constructor(
    @InjectModel(KycSubmission.name)
    private readonly submissionModel: Model<KycSubmissionDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly notificationsService: NotificationsService,
    private readonly emailService: EmailService,
  ) {}

  // ─── User-facing ────────────────────────────────────

  /**
   * User submits KYC details for review. Replaces any existing PENDING
   * submission (so a user can edit before admin reviews) but creates a
   * fresh row when the previous status was APPROVED or REJECTED.
   */
  async submitForReview(
    userId: string,
    dto: SubmitKycDto,
  ): Promise<KycSubmissionDocument> {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    if (user.kycTier === KycTier.TIER_2) {
      throw new BadRequestException('You are already on Tier 2.');
    }
    if (user.kycStatus === KycStatus.PENDING) {
      throw new BadRequestException(
        'You already have a pending submission. Please wait for review.',
      );
    }

    const submission = await this.submissionModel.create({
      userId: new Types.ObjectId(userId),
      bvn: dto.bvn,
      nin: dto.nin,
      dateOfBirth: dto.dateOfBirth,
      idType: dto.idType,
      selfieUrl: dto.selfieUrl,
      idDocumentUrl: dto.idDocumentUrl,
      status: KycSubmissionStatus.PENDING,
    });

    user.kycStatus = KycStatus.PENDING;
    user.latestKycSubmissionId = submission._id as Types.ObjectId;
    await user.save();

    this.logger.log(`KYC submitted by user ${userId} → ${submission._id}`);

    // Best-effort acknowledgement (in-app inbox row only — no push, no email)
    try {
      await this.notificationsService.sendToUser(
        userId,
        'KYC submission received',
        "We're reviewing your details. You'll get a notification within 24 hours.",
        { type: 'kyc_submitted', submissionId: submission._id.toString() },
        NotificationType.SECURITY,
        'kyc_submitted',
      );
    } catch (err) {
      this.logger.warn(
        `Failed to send KYC submitted notification to ${userId}: ${
          (err as Error).message
        }`,
      );
    }

    return submission;
  }

  /**
   * Returns the user's current KYC + wallet-limit picture for the mobile UI.
   */
  async getStatusForUser(userId: string): Promise<KycStatusResponse> {
    const user = await this.userModel
      .findById(userId)
      .select('kycTier walletLimit kycStatus latestKycSubmissionId')
      .lean();
    if (!user) throw new NotFoundException('User not found');

    let latest: KycStatusResponse['latestSubmission'] = null;
    if (user.latestKycSubmissionId) {
      const sub = await this.submissionModel
        .findById(user.latestKycSubmissionId)
        .select('status createdAt reviewedAt rejectionReason')
        .lean();
      if (sub) {
        latest = {
          id: sub._id.toString(),
          status: sub.status,
          submittedAt: sub.createdAt.toISOString(),
          reviewedAt: sub.reviewedAt ? sub.reviewedAt.toISOString() : null,
          rejectionReason: sub.rejectionReason,
        };
      }
    }

    return {
      kycTier: user.kycTier,
      walletLimit: user.walletLimit,
      walletLimitNaira: user.walletLimit / 100,
      kycStatus: user.kycStatus,
      latestSubmission: latest,
      nextTierLimit: DEFAULT_TIER_2_LIMIT_KOBO,
      nextTierLimitNaira: DEFAULT_TIER_2_LIMIT_KOBO / 100,
    };
  }

  // ─── Admin ──────────────────────────────────────────

  async listForAdmin(
    query: AdminKycQueryDto,
  ): Promise<PaginatedResult<KycSubmissionDocument>> {
    const filter: Record<string, unknown> = {};
    if (query.status) filter.status = query.status;

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const total = await this.submissionModel.countDocuments(filter);
    const data = await this.submissionModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(calculateSkip(page, limit))
      .limit(limit)
      .populate('userId', 'fullName email phone')
      .populate('reviewedBy', 'fullName email');

    return paginate(data, total, page, limit);
  }

  async getOneForAdmin(id: string): Promise<KycSubmissionDocument> {
    const submission = await this.submissionModel
      .findById(id)
      .populate('userId', 'fullName email phone kycTier walletLimit')
      .populate('reviewedBy', 'fullName email');
    if (!submission) throw new NotFoundException('Submission not found');
    return submission;
  }

  /**
   * Admin approves: bumps user to Tier 2 with the configured (or override)
   * wallet limit, sets timestamps, sends push + email + in-app inbox row.
   */
  async approve(
    submissionId: string,
    adminUserId: string,
    dto: ApproveKycDto,
  ): Promise<KycSubmissionDocument> {
    const submission = await this.submissionModel.findById(submissionId);
    if (!submission) throw new NotFoundException('Submission not found');
    if (submission.status !== KycSubmissionStatus.PENDING) {
      throw new BadRequestException(
        `Submission is already ${submission.status.toLowerCase()}.`,
      );
    }

    const user = await this.userModel.findById(submission.userId);
    if (!user) throw new NotFoundException('User not found');

    const newLimit = dto.walletLimitOverride ?? DEFAULT_TIER_2_LIMIT_KOBO;

    submission.status = KycSubmissionStatus.APPROVED;
    submission.reviewedAt = new Date();
    submission.reviewedBy = new Types.ObjectId(adminUserId);
    submission.adminNotes = dto.adminNotes ?? null;
    await submission.save();

    user.kycTier = KycTier.TIER_2;
    user.walletLimit = newLimit;
    user.kycStatus = KycStatus.APPROVED;
    await user.save();

    this.logger.log(
      `KYC approved: submission=${submissionId} user=${user._id} newLimit=${newLimit}`,
    );

    await this.notifyApproval(user, submission, newLimit).catch((err) =>
      this.logger.warn(`Approval notification failed: ${err.message}`),
    );

    return submission;
  }

  /**
   * Admin rejects with a reason. User stays at current tier and may resubmit.
   */
  async reject(
    submissionId: string,
    adminUserId: string,
    dto: RejectKycDto,
  ): Promise<KycSubmissionDocument> {
    const submission = await this.submissionModel.findById(submissionId);
    if (!submission) throw new NotFoundException('Submission not found');
    if (submission.status !== KycSubmissionStatus.PENDING) {
      throw new BadRequestException(
        `Submission is already ${submission.status.toLowerCase()}.`,
      );
    }

    const user = await this.userModel.findById(submission.userId);
    if (!user) throw new NotFoundException('User not found');

    submission.status = KycSubmissionStatus.REJECTED;
    submission.reviewedAt = new Date();
    submission.reviewedBy = new Types.ObjectId(adminUserId);
    submission.rejectionReason = dto.reason;
    submission.adminNotes = dto.adminNotes ?? null;
    await submission.save();

    user.kycStatus = KycStatus.REJECTED;
    await user.save();

    this.logger.log(
      `KYC rejected: submission=${submissionId} user=${user._id}`,
    );

    await this.notifyRejection(user, submission).catch((err) =>
      this.logger.warn(`Rejection notification failed: ${err.message}`),
    );

    return submission;
  }

  // ─── Notifications ──────────────────────────────────

  private async notifyApproval(
    user: UserDocument,
    submission: KycSubmissionDocument,
    newLimit: number,
  ): Promise<void> {
    const limitNaira = (newLimit / 100).toLocaleString('en-NG');
    const userIdStr = (user._id as Types.ObjectId).toString();
    const title = '🎉 KYC approved';
    const body = `Welcome to Tier 2. Your wallet limit is now ₦${limitNaira}. Tap to start spending bigger.`;

    // Push + in-app inbox (single call)
    await this.notificationsService.sendToUser(
      userIdStr,
      title,
      body,
      {
        type: 'kyc_approved',
        submissionId: submission._id.toString(),
        newTier: 'TIER_2',
        newLimit: String(newLimit),
      },
      NotificationType.SECURITY,
      'kyc_approved',
    );

    // Email
    if (user.email) {
      await this.emailService.send({
        to: user.email,
        subject: 'Your Peyaa KYC has been approved',
        html: this.buildApprovalEmailHtml(user.fullName, limitNaira),
        text: body,
      });
    }
  }

  private async notifyRejection(
    user: UserDocument,
    submission: KycSubmissionDocument,
  ): Promise<void> {
    const userIdStr = (user._id as Types.ObjectId).toString();
    const title = 'KYC needs another look';
    const body = `Your submission was not approved. Reason: ${submission.rejectionReason}`;

    await this.notificationsService.sendToUser(
      userIdStr,
      title,
      body,
      {
        type: 'kyc_rejected',
        submissionId: submission._id.toString(),
        reason: submission.rejectionReason ?? '',
      },
      NotificationType.SECURITY,
      'kyc_rejected',
    );

    if (user.email) {
      await this.emailService.send({
        to: user.email,
        subject: 'Your Peyaa KYC was not approved',
        html: this.buildRejectionEmailHtml(
          user.fullName,
          submission.rejectionReason ?? 'No reason provided.',
        ),
        text: body,
      });
    }
  }

  private buildApprovalEmailHtml(name: string | undefined, limit: string): string {
    const first = (name ?? 'there').split(/\s+/)[0];
    return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#F5F3FF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1E1B4B;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F3FF;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px rgba(91,33,182,0.08);">
        <tr><td style="background:linear-gradient(135deg,#7C3AED 0%,#5B21B6 100%);padding:24px 28px;color:#FFFFFF;">
          <div style="font-size:20px;font-weight:800;letter-spacing:-0.3px;">Peyaa</div>
        </td></tr>
        <tr><td style="padding:32px 28px;">
          <h1 style="margin:0 0 12px 0;font-size:22px;font-weight:800;color:#1E1B4B;line-height:1.3;">Welcome to Tier 2, ${escape(first)} 🎉</h1>
          <p style="margin:0 0 16px 0;font-size:14px;color:#6B7280;line-height:1.5;">Your KYC has been approved. Your wallet limit is now <strong style="color:#7C3AED;">₦${escape(limit)}</strong>.</p>
          <p style="margin:0 0 24px 0;font-size:14px;color:#6B7280;line-height:1.5;">You can now top up larger amounts and access higher payment limits across bills, airtime, and gift cards.</p>
          <a href="https://peyaa.com/app/wallet" style="display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#7C3AED 0%,#5B21B6 100%);color:#FFFFFF;text-decoration:none;border-radius:12px;font-weight:700;font-size:15px;">Open Peyaa</a>
        </td></tr>
        <tr><td style="padding:20px 28px;background:#FAFAFB;font-size:11px;color:#9CA3AF;text-align:center;">© ${new Date().getFullYear()} Peyaa. All rights reserved.</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
  }

  private buildRejectionEmailHtml(name: string | undefined, reason: string): string {
    const first = (name ?? 'there').split(/\s+/)[0];
    return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#F5F3FF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1E1B4B;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F3FF;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px rgba(91,33,182,0.08);">
        <tr><td style="background:linear-gradient(135deg,#7C3AED 0%,#5B21B6 100%);padding:24px 28px;color:#FFFFFF;">
          <div style="font-size:20px;font-weight:800;letter-spacing:-0.3px;">Peyaa</div>
        </td></tr>
        <tr><td style="padding:32px 28px;">
          <h1 style="margin:0 0 12px 0;font-size:22px;font-weight:800;color:#1E1B4B;line-height:1.3;">Hi ${escape(first)}, your KYC needs another look</h1>
          <p style="margin:0 0 12px 0;font-size:14px;color:#6B7280;line-height:1.5;">Unfortunately we couldn't approve your submission. Here's why:</p>
          <div style="background:#FEF2F2;border:1px solid #FCA5A5;border-radius:12px;padding:14px;margin-bottom:20px;">
            <p style="margin:0;font-size:13px;color:#DC2626;line-height:1.5;">${escape(reason)}</p>
          </div>
          <p style="margin:0 0 24px 0;font-size:14px;color:#6B7280;line-height:1.5;">You can resubmit at any time from the Peyaa app.</p>
          <a href="https://peyaa.com/app/kyc" style="display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#7C3AED 0%,#5B21B6 100%);color:#FFFFFF;text-decoration:none;border-radius:12px;font-weight:700;font-size:15px;">Resubmit KYC</a>
        </td></tr>
        <tr><td style="padding:20px 28px;background:#FAFAFB;font-size:11px;color:#9CA3AF;text-align:center;">© ${new Date().getFullYear()} Peyaa. All rights reserved.</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
  }
}

function escape(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
