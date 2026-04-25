/**
 * Wallet Service
 *
 * Handles wallet operations including:
 * - Wallet creation
 * - Balance queries
 * - Credit/Debit operations (atomic)
 * - Transaction history
 */
import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
  ConflictException,
  Inject,
  forwardRef,
} from "@nestjs/common";
import { InjectModel, InjectConnection } from "@nestjs/mongoose";
import { Model, Types, ClientSession, Connection } from "mongoose";
import { Wallet, WalletDocument, WalletStatus } from "./schemas/wallet.schema";
import {
  WalletTransaction,
  WalletTransactionDocument,
  TransactionType,
  TransactionCategory,
  TransactionSource,
  TransactionStatus,
} from "./schemas/wallet-transaction.schema";
import { PaystackService } from "../paystack/paystack.service";
import { ReferralService } from "../referral/referral.service";
import { NotificationsService } from "../notifications/notifications.service";
import { NotificationType } from "../notifications/schemas/user-notification.schema";
import {
  generateReference,
  paginate,
  calculateSkip,
  toKobo,
  toNaira,
} from "../common/utils/helpers";
import { PaginatedResult } from "../common/dto/pagination.dto";
import {
  InitializeTopupDto,
  TransactionsQueryDto,
  WalletBalanceResponse,
  InitializeTopupResponse,
} from "./dto";

export interface CreditWalletParams {
  userId: string | Types.ObjectId;
  amount: number; // In kobo
  category: TransactionCategory;
  source: TransactionSource;
  narration: string;
  reference?: string;
  relatedId?: Types.ObjectId;
  meta?: Record<string, any>;
  session?: ClientSession;
}

export interface DebitWalletParams {
  userId: string | Types.ObjectId;
  amount: number; // In kobo
  category: TransactionCategory;
  source: TransactionSource;
  narration: string;
  reference?: string;
  relatedId?: Types.ObjectId;
  meta?: Record<string, any>;
  session?: ClientSession;
}

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    @InjectModel(Wallet.name)
    private readonly walletModel: Model<WalletDocument>,
    @InjectModel(WalletTransaction.name)
    private readonly transactionModel: Model<WalletTransactionDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly paystackService: PaystackService,
    @Inject(forwardRef(() => ReferralService)) private readonly referralService: ReferralService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Create a wallet for a user
   */
  async createWallet(
    userId: string | Types.ObjectId,
    session?: ClientSession,
  ): Promise<WalletDocument> {
    const wallet = new this.walletModel({
      userId: new Types.ObjectId(userId),
      balance: 0,
      currency: "NGN",
      status: WalletStatus.ACTIVE,
    });

    const saved = await wallet.save({ session });
    this.logger.log(`Wallet created for user: ${userId}`);
    return saved;
  }

  /**
   * Get wallet by user ID
   */
  async getWalletByUserId(
    userId: string | Types.ObjectId,
  ): Promise<WalletDocument> {
    const wallet = await this.walletModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .exec();

    if (!wallet) {
      throw new NotFoundException("Wallet not found");
    }

    return wallet;
  }

  /**
   * Get wallet balance with formatted response
   */
  async getBalance(userId: string): Promise<WalletBalanceResponse> {
    const wallet = await this.getWalletByUserId(userId);

    return {
      walletId: wallet._id.toString(),
      balance: wallet.balance,
      currency: wallet.currency,
      status: wallet.status,
      formattedBalance: toNaira(wallet.balance).toFixed(2),
    };
  }

  /**
   * Credit wallet (atomic operation)
   */
  async creditWallet(params: CreditWalletParams): Promise<WalletTransaction> {
    const session = params.session || (await this.connection.startSession());
    const shouldCommit = !params.session;

    if (shouldCommit) {
      session.startTransaction();
    }

    try {
      const wallet = await this.walletModel
        .findOne({ userId: new Types.ObjectId(params.userId) })
        .session(session);

      if (!wallet) {
        throw new NotFoundException("Wallet not found");
      }

      if (wallet.status !== WalletStatus.ACTIVE) {
        throw new BadRequestException("Wallet is not active");
      }

      const balanceBefore = wallet.balance;
      const balanceAfter = balanceBefore + params.amount;

      // Update wallet balance atomically
      const updatedWallet = await this.walletModel.findByIdAndUpdate(
        wallet._id,
        {
          $inc: { balance: params.amount },
          lastTransactionAt: new Date(),
        },
        { new: true, session },
      );

      // Create transaction record
      const reference = params.reference || generateReference("CR");
      const transaction = new this.transactionModel({
        userId: new Types.ObjectId(params.userId),
        walletId: wallet._id,
        type: TransactionType.CREDIT,
        category: params.category,
        source: params.source,
        amount: params.amount,
        currency: wallet.currency,
        reference,
        status: TransactionStatus.SUCCESS,
        balanceBefore,
        balanceAfter,
        narration: params.narration,
        meta: params.meta,
        relatedId: params.relatedId,
      });

      const savedTxn = await transaction.save({ session });

      if (shouldCommit) {
        await session.commitTransaction();
      }

      this.logger.log(
        `Wallet credited: ${params.userId}, amount: ${params.amount}, ref: ${reference}`,
      );

      // Send notification (non-blocking)
      try {
        const nairaAmount = (params.amount / 100).toLocaleString("en-NG");
        await this.notificationsService.sendToUser(
          params.userId.toString(),
          "Wallet Credited",
          `\u20A6${nairaAmount} has been added to your wallet.`,
          { type: "wallet_credit" },
          NotificationType.TRANSACTION,
        );
      } catch (notifErr: any) {
        this.logger.warn(`Notification failed: ${notifErr.message}`);
      }

      // Check referral qualification (non-blocking)
      try {
        await this.referralService.checkAndQualifyReferral(
          params.userId.toString(),
          params.amount,
        );
      } catch (refErr: any) {
        this.logger.warn(`Referral qualification check failed: ${refErr.message}`);
      }

      return savedTxn;
    } catch (error) {
      if (shouldCommit) {
        await session.abortTransaction();
      }
      throw error;
    } finally {
      if (shouldCommit) {
        session.endSession();
      }
    }
  }

  /**
   * Debit wallet (atomic operation)
   */
  async debitWallet(params: DebitWalletParams): Promise<WalletTransaction> {
    const session = params.session || (await this.connection.startSession());
    const shouldCommit = !params.session;

    if (shouldCommit) {
      session.startTransaction();
    }

    try {
      const wallet = await this.walletModel
        .findOne({ userId: new Types.ObjectId(params.userId) })
        .session(session);

      if (!wallet) {
        throw new NotFoundException("Wallet not found");
      }

      if (wallet.status !== WalletStatus.ACTIVE) {
        throw new BadRequestException("Wallet is not active");
      }

      if (wallet.balance < params.amount) {
        throw new BadRequestException("Insufficient wallet balance");
      }

      const balanceBefore = wallet.balance;
      const balanceAfter = balanceBefore - params.amount;

      // Update wallet balance atomically with optimistic locking
      const updatedWallet = await this.walletModel.findOneAndUpdate(
        {
          _id: wallet._id,
          balance: { $gte: params.amount }, // Double-check balance
        },
        {
          $inc: { balance: -params.amount },
          lastTransactionAt: new Date(),
        },
        { new: true, session },
      );

      if (!updatedWallet) {
        throw new BadRequestException(
          "Insufficient balance or concurrent modification",
        );
      }

      // Create transaction record
      const reference = params.reference || generateReference("DR");
      const transaction = new this.transactionModel({
        userId: new Types.ObjectId(params.userId),
        walletId: wallet._id,
        type: TransactionType.DEBIT,
        category: params.category,
        source: params.source,
        amount: params.amount,
        currency: wallet.currency,
        reference,
        status: TransactionStatus.SUCCESS,
        balanceBefore,
        balanceAfter,
        narration: params.narration,
        meta: params.meta,
        relatedId: params.relatedId,
      });

      const savedTxn = await transaction.save({ session });

      if (shouldCommit) {
        await session.commitTransaction();
      }

      this.logger.log(
        `Wallet debited: ${params.userId}, amount: ${params.amount}, ref: ${reference}`,
      );

      return savedTxn;
    } catch (error) {
      if (shouldCommit) {
        await session.abortTransaction();
      }
      throw error;
    } finally {
      if (shouldCommit) {
        session.endSession();
      }
    }
  }

  /**
   * Create a pending debit transaction (for operations that may fail)
   */
  async createPendingDebit(params: DebitWalletParams): Promise<{
    transaction: WalletTransaction;
    session: ClientSession;
  }> {
    const session = await this.connection.startSession();
    session.startTransaction();

    try {
      const wallet = await this.walletModel
        .findOne({ userId: new Types.ObjectId(params.userId) })
        .session(session);

      if (!wallet) {
        throw new NotFoundException("Wallet not found");
      }

      if (wallet.status !== WalletStatus.ACTIVE) {
        throw new BadRequestException("Wallet is not active");
      }

      if (wallet.balance < params.amount) {
        throw new BadRequestException("Insufficient wallet balance");
      }

      const balanceBefore = wallet.balance;
      const balanceAfter = balanceBefore - params.amount;

      // Debit immediately but mark transaction as PENDING
      await this.walletModel.findOneAndUpdate(
        {
          _id: wallet._id,
          balance: { $gte: params.amount },
        },
        {
          $inc: { balance: -params.amount },
          lastTransactionAt: new Date(),
        },
        { session },
      );

      const reference = params.reference || generateReference("DR");
      const transaction = new this.transactionModel({
        userId: new Types.ObjectId(params.userId),
        walletId: wallet._id,
        type: TransactionType.DEBIT,
        category: params.category,
        source: params.source,
        amount: params.amount,
        currency: wallet.currency,
        reference,
        status: TransactionStatus.PENDING,
        balanceBefore,
        balanceAfter,
        narration: params.narration,
        meta: params.meta,
        relatedId: params.relatedId,
      });

      const savedTxn = await transaction.save({ session });

      // Don't commit yet - caller will commit or abort based on external API result
      return { transaction: savedTxn, session };
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  }

  /**
   * Mark pending transaction as successful
   */
  async markTransactionSuccess(
    transactionId: string | Types.ObjectId,
    session: ClientSession,
    meta?: Record<string, any>,
  ): Promise<void> {
    await this.transactionModel.findByIdAndUpdate(
      transactionId,
      {
        status: TransactionStatus.SUCCESS,
        ...(meta ? { $set: { "meta.response": meta } } : {}),
      },
      { session },
    );

    await session.commitTransaction();
    session.endSession();
  }

  /**
   * Refund a failed pending transaction
   */
  async refundPendingTransaction(
    transactionId: string | Types.ObjectId,
    session: ClientSession,
    failureReason?: string,
  ): Promise<void> {
    const transaction = await this.transactionModel
      .findById(transactionId)
      .session(session);

    if (!transaction) {
      throw new NotFoundException("Transaction not found");
    }

    // Refund the wallet
    await this.walletModel.findByIdAndUpdate(
      transaction.walletId,
      {
        $inc: { balance: transaction.amount },
        lastTransactionAt: new Date(),
      },
      { session },
    );

    // Mark transaction as failed
    await this.transactionModel.findByIdAndUpdate(
      transactionId,
      {
        status: TransactionStatus.FAILED,
        $set: { "meta.failureReason": failureReason },
      },
      { session },
    );

    await session.commitTransaction();
    session.endSession();

    this.logger.log(`Transaction refunded: ${transactionId}`);
  }

  /**
   * Get transaction history with pagination
   */
  /**
   * Get transaction history with pagination - DEBUG VERSION
   */
  async getTransactions(
    userId: string,
    query: TransactionsQueryDto,
  ): Promise<PaginatedResult<WalletTransaction>> {
    const { page = 1, limit = 10, type, category, status } = query;

    // ========== DEBUG LOGGING ==========
    this.logger.debug(`[getTransactions] Input userId: "${userId}"`);

    // Check total transactions in DB
    const totalInDb = await this.transactionModel.countDocuments({});
    this.logger.debug(
      `[getTransactions] Total transactions in DB: ${totalInDb}`,
    );

    // Get a sample to see what userId looks like in DB
    const sample = await this.transactionModel.findOne({}).lean();
    if (sample) {
      this.logger.debug(
        `[getTransactions] Sample txn userId: "${sample.userId}"`,
      );
      this.logger.debug(
        `[getTransactions] Sample txn userId type: ${typeof sample.userId}`,
      );
    }
    // ========== END DEBUG ==========

    const filter: any = { userId: new Types.ObjectId(userId) };
    if (type) filter.type = type;
    if (category) filter.category = category;
    if (status) filter.status = status;

    const [transactions, total] = await Promise.all([
      this.transactionModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(calculateSkip(page, limit))
        .limit(limit)
        .lean()
        .exec(),
      this.transactionModel.countDocuments(filter),
    ]);

    // ========== DEBUG LOGGING ==========
    this.logger.debug(`[getTransactions] Filtered count: ${total}`);
    // ========== END DEBUG ==========

    return paginate(transactions, total, page, limit);
  }

  /**
   * Find transaction by reference
   */
  async findTransactionByReference(
    reference: string,
  ): Promise<WalletTransactionDocument | null> {
    return this.transactionModel.findOne({ reference }).exec();
  }

  // =====================
  // Paystack Top-up
  // =====================

  /**
   * Initialize Paystack top-up
   */
  async initializeTopup(
    userId: string,
    email: string,
    dto: InitializeTopupDto,
  ): Promise<InitializeTopupResponse> {
    const reference = generateReference("TOPUP");
    const amountInKobo = toKobo(dto.amount);

    // Initialize Paystack transaction
    const paystackResult = await this.paystackService.initializeTransaction({
      email,
      amount: amountInKobo,
      reference,
      callbackUrl: dto.callbackUrl,
      metadata: {
        userId,
        type: "WALLET_TOPUP",
      },
    });

    return {
      authorizationUrl: paystackResult.authorizationUrl,
      accessCode: paystackResult.accessCode,
      reference: paystackResult.reference,
    };
  }

  /**
   * Verify Paystack top-up (called after payment)
   */
  async verifyTopup(
    reference: string,
    userId: string,
  ): Promise<{ success: boolean; message: string }> {
    // Check if already processed
    const existingTxn = await this.findTransactionByReference(reference);
    if (existingTxn && existingTxn.status === TransactionStatus.SUCCESS) {
      return { success: true, message: "Payment already processed" };
    }

    // Verify with Paystack
    const verification =
      await this.paystackService.verifyTransaction(reference);

    if (!verification.success) {
      return { success: false, message: "Payment verification failed" };
    }

    // Credit wallet (idempotent - check reference)
    try {
      await this.creditWallet({
        userId,
        amount: verification.amount,
        category: TransactionCategory.TOPUP,
        source: TransactionSource.PAYSTACK_TOPUP,
        narration: `Wallet top-up via Paystack`,
        reference,
        meta: {
          paystackReference: reference,
          channel: verification.channel,
        },
      });

      return { success: true, message: "Wallet topped up successfully" };
    } catch (error) {
      if (error.code === 11000) {
        // Duplicate reference - already processed
        return { success: true, message: "Payment already processed" };
      }
      throw error;
    }
  }

  async updateTransactionStatus(
    transactionId: string,
    status: "PENDING" | "SUCCESS" | "FAILED",
  ): Promise<WalletTransactionDocument> {
    const transaction = await this.transactionModel.findById(transactionId); // ← FIX HERE

    if (!transaction) {
      throw new NotFoundException(`Transaction ${transactionId} not found`);
    }

    transaction.status = status as TransactionStatus;
    await transaction.save();

    this.logger.debug(
      `Transaction ${transactionId} status updated to ${status}`,
    );

    return transaction;
  }
}
