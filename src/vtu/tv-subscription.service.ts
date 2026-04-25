/**
 * TV Subscription Service
 *
 * Handles DSTV, GOtv, and StarTimes subscription purchases via VTPass.
 * - Verify smartcard → get bouquets → purchase subscription
 * - Wallet debit + auto-refund on failure
 */
import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Connection, Types } from 'mongoose';
import * as crypto from 'crypto';
import {
  TvPurchase,
  TvPurchaseDocument,
  TvPurchaseStatus,
  TvProvider,
  TvSubscriptionType,
} from './schemas/tv-subscription.schema';
import { VtpassService } from './vtpass.service';
import { WalletService } from '../wallet/wallet.service';
import {
  TransactionCategory,
  TransactionSource,
  WalletTransactionDocument,
} from '../wallet/schemas/wallet-transaction.schema';
import {
  VerifySmartcardDto,
  PurchaseTvDto,
  GetTvPurchasesDto,
} from './dto/tv-subscription.dto';

const PROVIDER_NAMES: Record<TvProvider, string> = {
  [TvProvider.DSTV]: 'DStv',
  [TvProvider.GOTV]: 'GOtv',
  [TvProvider.STARTIMES]: 'StarTimes',
  [TvProvider.SHOWMAX]: 'Showmax',
};

// Providers that support smartcard verification
const SMARTCARD_PROVIDERS = [TvProvider.DSTV, TvProvider.GOTV, TvProvider.STARTIMES];
// Providers that support subscription_type (change/renew)
const SUBSCRIPTION_TYPE_PROVIDERS = [TvProvider.DSTV, TvProvider.GOTV];

@Injectable()
export class TvService {
  private readonly logger = new Logger(TvService.name);

  constructor(
    @InjectModel(TvPurchase.name)
    private readonly tvModel: Model<TvPurchaseDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly vtpassService: VtpassService,
    private readonly walletService: WalletService,
  ) {}

  // ─── Providers ─────────────────────────────────────────

  /** Get list of TV providers. */
  getProviders() {
    return [
      { code: TvProvider.DSTV, name: 'DStv', logo: null, hasSmartcard: true, hasSubscriptionType: true },
      { code: TvProvider.GOTV, name: 'GOtv', logo: null, hasSmartcard: true, hasSubscriptionType: true },
      { code: TvProvider.STARTIMES, name: 'StarTimes', logo: null, hasSmartcard: true, hasSubscriptionType: false },
      { code: TvProvider.SHOWMAX, name: 'Showmax', logo: null, hasSmartcard: false, hasSubscriptionType: false },
    ];
  }

  // ─── Bouquets ──────────────────────────────────────────

  /** Get available bouquets/plans for a TV provider. */
  async getBouquets(provider: TvProvider) {
    const variations = await this.vtpassService.getTvBouquets(provider);

    return variations.map((v: any) => ({
      code: v.variation_code,
      name: v.name,
      amount: parseFloat(v.variation_amount) || 0,
    }));
  }

  // ─── Smartcard Verification ────────────────────────────

  /** Verify a smartcard/decoder number with VTPass. Showmax does not support verification. */
  async verifySmartcard(dto: VerifySmartcardDto) {
    if (dto.provider === TvProvider.SHOWMAX) {
      throw new BadRequestException('Showmax does not require smartcard verification. Use your phone number directly.');
    }

    try {
      const content = await this.vtpassService.verifySmartcard({
        provider: dto.provider,
        smartcardNumber: dto.smartcardNumber,
      });

      return {
        customerName: content?.customerName || '',
        currentBouquet: content?.currentBouquet || null,
        dueDate: content?.dueDate || null,
        renewalAmount: null,
        status: null,
        smartcardNumber: dto.smartcardNumber,
        provider: dto.provider,
        providerName: PROVIDER_NAMES[dto.provider],
      };
    } catch (error: any) {
      this.logger.error(`Smartcard verification failed: ${error.message}`);
      throw error instanceof BadRequestException
        ? error
        : new BadRequestException('Smartcard verification failed. Please check the number and try again.');
    }
  }

  // ─── Purchase ──────────────────────────────────────────

  /** Purchase TV subscription with wallet debit (atomic — user is only billed on success). */
  async purchaseTv(
    userId: string,
    dto: PurchaseTvDto,
  ): Promise<TvPurchaseDocument> {
    const reference = this.generateReference();
    const requestId = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const providerName = PROVIDER_NAMES[dto.provider];

    // Determine billersCode: smartcard for DStv/GOtv/StarTimes, phone for Showmax
    const billersCode = dto.provider === TvProvider.SHOWMAX
      ? this.formatPhone(dto.phone)
      : dto.smartcardNumber;
    const identifier = billersCode || dto.phone;

    this.logger.log(
      `TV purchase initiated: user=${userId}, provider=${dto.provider}, identifier=${identifier}, bouquet=${dto.bouquetCode || 'renew'}, ref=${reference}`,
    );

    const session = await this.connection.startSession();
    session.startTransaction();

    let purchaseDoc: TvPurchaseDocument | null = null;

    try {
      // 1. Create pending purchase record (within transaction)
      const [created] = await this.tvModel.create(
        [{
          userId: new Types.ObjectId(userId),
          provider: dto.provider,
          providerName,
          smartcardNumber: dto.smartcardNumber || '',
          customerName: dto.customerName || '',
          bouquetCode: dto.bouquetCode || '',
          bouquetName: dto.bouquetName || '',
          subscriptionType: dto.subscriptionType,
          amount: dto.amount,
          quantity: dto.quantity,
          phoneNumber: dto.phone,
          reference,
          requestId,
          status: TvPurchaseStatus.PENDING,
        }],
        { session },
      );
      purchaseDoc = created;

      // 2. Debit wallet (within transaction — NOT committed yet)
      const walletTxn = await this.walletService.debitWallet({
        userId,
        amount: dto.amount * 100, // kobo
        category: TransactionCategory.TV_SUBSCRIPTION,
        source: TransactionSource.VTU_VTPASS,
        reference,
        narration: `${providerName} subscription: ${dto.bouquetName || 'Renewal'} - ${identifier}`,
        meta: {
          vtuType: 'TV',
          provider: dto.provider,
          providerName,
          smartcardNumber: dto.smartcardNumber || null,
          bouquetCode: dto.bouquetCode || null,
          bouquetName: dto.bouquetName || null,
          subscriptionType: dto.subscriptionType || null,
          purchaseId: purchaseDoc._id.toString(),
        },
        session,
      });

      purchaseDoc.walletTransactionId = (walletTxn as any)._id;
      await purchaseDoc.save({ session });

      // 3. Call VTPass — provider-specific request building
      const phone = this.formatPhone(dto.phone);
      const purchaseParams: any = {
        requestId,
        serviceID: dto.provider,
        billersCode: identifier,
        amount: dto.amount,
        phone,
      };

      if (SUBSCRIPTION_TYPE_PROVIDERS.includes(dto.provider)) {
        purchaseParams.subscriptionType = dto.subscriptionType || TvSubscriptionType.CHANGE;
        if (dto.subscriptionType === TvSubscriptionType.RENEW) {
          this.logger.debug(`${providerName} RENEW: amount=${dto.amount}, no variation_code`);
        } else {
          purchaseParams.variationCode = dto.bouquetCode;
          if (dto.quantity) purchaseParams.quantity = dto.quantity;
        }
      } else {
        purchaseParams.variationCode = dto.bouquetCode;
      }

      const result = await this.vtpassService.purchaseTvSubscription({
        provider: dto.provider,
        smartcardNumber: identifier || '',
        bouquetCode: purchaseParams.variationCode || dto.bouquetCode || '',
        amount: dto.amount,
        phone,
        reference: requestId,
        subscriptionType: purchaseParams.subscriptionType || 'renew',
      });

      // 4. VTPass succeeded — update purchase and COMMIT transaction (wallet debit is finalized)
      purchaseDoc.status = TvPurchaseStatus.SUCCESS;
      purchaseDoc.providerReference = result.transactionId || requestId;
      purchaseDoc.providerResponse = result.raw;
      await purchaseDoc.save({ session });

      await session.commitTransaction();
      this.logger.log(`TV purchase successful: ${reference}`);
      return purchaseDoc;
    } catch (error: any) {
      // VTPass failed — ABORT transaction (wallet debit is automatically rolled back)
      await session.abortTransaction();
      this.logger.error(`TV purchase failed: ${reference} — ${error.message}`);

      // Record the failure outside the transaction
      if (purchaseDoc) {
        await this.tvModel.findByIdAndUpdate(purchaseDoc._id, {
          status: TvPurchaseStatus.FAILED,
          failureReason: error?.response?.data?.response_description || error.message,
        });
      }

      throw error instanceof BadRequestException
        ? error
        : new BadRequestException(
            error?.response?.data?.response_description || error.message || 'TV subscription failed',
          );
    } finally {
      session.endSession();
    }
  }

  // ─── Purchase History ──────────────────────────────────

  /** Get user's TV purchase history. */
  async getUserPurchases(userId: string, query: GetTvPurchasesDto) {
    const { page = 1, limit = 20, status, provider } = query;
    const skip = (page - 1) * limit;

    const filter: any = { userId: new Types.ObjectId(userId) };
    if (status) filter.status = status;
    if (provider) filter.provider = provider;

    const [purchases, total] = await Promise.all([
      this.tvModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      this.tvModel.countDocuments(filter),
    ]);

    return {
      data: purchases,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /** Get a specific purchase by reference. */
  async getPurchaseByReference(userId: string, reference: string) {
    const purchase = await this.tvModel.findOne({
      userId: new Types.ObjectId(userId),
      reference,
    }).lean();

    if (!purchase) throw new NotFoundException('TV purchase not found');
    return purchase;
  }

  // ─── Admin ─────────────────────────────────────────────

  /** Get all TV purchases — admin view. */
  async getAllPurchases(query: GetTvPurchasesDto & { userId?: string }) {
    const { page = 1, limit = 20, status, provider, userId } = query;
    const skip = (page - 1) * limit;

    const filter: any = {};
    if (status) filter.status = status;
    if (provider) filter.provider = provider;
    if (userId) filter.userId = new Types.ObjectId(userId);

    const [purchases, total] = await Promise.all([
      this.tvModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      this.tvModel.countDocuments(filter),
    ]);

    return {
      data: purchases,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /** Manual refund — admin action. */
  async manualRefund(id: string, adminId: string, reason: string) {
    const purchase = await this.tvModel.findById(id);
    if (!purchase) throw new NotFoundException('TV purchase not found');
    if (purchase.status === TvPurchaseStatus.REFUNDED) {
      throw new BadRequestException('Already refunded');
    }
    if (purchase.status === TvPurchaseStatus.SUCCESS) {
      throw new BadRequestException('Cannot refund successful transaction');
    }

    const session = await this.connection.startSession();
    session.startTransaction();

    try {
      await this.walletService.creditWallet({
        userId: purchase.userId.toString(),
        amount: purchase.amount * 100,
        category: TransactionCategory.TV_SUBSCRIPTION,
        source: TransactionSource.VTU_VTPASS,
        reference: `REFUND_${purchase.reference}`,
        narration: `Refund: ${purchase.providerName} subscription ${purchase.reference}`,
        meta: { originalReference: purchase.reference, refundReason: reason, adminId },
        session,
      });

      purchase.status = TvPurchaseStatus.REFUNDED;
      purchase.refundedAt = new Date();
      purchase.refundReason = reason;
      await purchase.save({ session });

      await session.commitTransaction();
      this.logger.log(`Manual refund: ${purchase.reference} by admin ${adminId}`);
      return purchase;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  // ─── Helpers ───────────────────────────────────────────

  private generateReference(): string {
    const ts = Date.now().toString(36).toUpperCase().slice(-8);
    const rand = crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 8);
    return `TV_${ts}_${rand}`;
  }

  private formatPhone(phone: string): string {
    let p = phone.replace(/[\s\-\+]/g, '');
    if (p.startsWith('234') && p.length === 13) p = '0' + p.slice(3);
    if (p.startsWith('+234')) p = '0' + p.slice(4);
    if (!p.startsWith('0') && p.length === 10) p = '0' + p;
    return p;
  }
}
