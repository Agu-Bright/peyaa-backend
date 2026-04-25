/**
 * Admin Service
 * Handles admin-specific business logic
 */
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { InjectModel, InjectConnection } from "@nestjs/mongoose";
import { Model, Connection, Types } from "mongoose";
import { User, UserDocument, UserStatus } from "../users/schemas/user.schema";
import { Wallet, WalletDocument } from "../wallet/schemas/wallet.schema";
import {
  WalletTransaction,
  WalletTransactionDocument,
  TransactionCategory,
  TransactionSource,
} from "../wallet/schemas/wallet-transaction.schema";
import {
  GiftCardTrade,
  GiftCardTradeDocument,
  TradeStatus,
} from "../giftcards/schemas/gift-card-trade.schema";
import {
  AirtimePurchase,
  AirtimePurchaseDocument,
  DataPurchase,
  DataPurchaseDocument,
} from "../vtu/schemas/vtu-purchase.schema";
import {
  PaystackTransaction,
  PaystackTransactionDocument,
} from "../paystack/schemas/paystack-transaction.schema";
import { WalletService } from "../wallet/wallet.service";
import { GiftCardsService } from "../giftcards/giftcards.service";
import {
  ManualWalletAdjustmentDto,
  AdjustmentType,
  UsersQueryDto,
  UpdateUserStatusDto,
  UpdateUserDetailsDto,
  VtuQueryDto,
  VtuTransactionType,
  ManualVtuRefundDto,
  PaystackQueryDto,
} from "./dto";
import { TransactionsQueryDto } from "../wallet/dto";
import {
  generateReference,
  paginate,
  calculateSkip,
  toKobo,
  toNaira,
} from "../common/utils/helpers";
import { PaginatedResult } from "../common/dto/pagination.dto";
import { ReviewTradeDto, TradeQueryDto } from "../giftcards/dto";
import { AuditService } from "../audit/audit.service";
import {
  AuditAction,
  AuditResource,
} from "../audit/schemas/audit-log.schema";

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Wallet.name)
    private readonly walletModel: Model<WalletDocument>,
    @InjectModel(WalletTransaction.name)
    private readonly walletTransactionModel: Model<WalletTransactionDocument>,
    @InjectModel(GiftCardTrade.name)
    private readonly tradeModel: Model<GiftCardTradeDocument>,
    @InjectModel(AirtimePurchase.name)
    private readonly airtimeModel: Model<AirtimePurchaseDocument>,
    @InjectModel(DataPurchase.name)
    private readonly dataModel: Model<DataPurchaseDocument>,
    @InjectModel(PaystackTransaction.name)
    private readonly paystackModel: Model<PaystackTransactionDocument>,
    @InjectConnection()
    private readonly connection: Connection,
    private readonly walletService: WalletService,
    private readonly giftCardsService: GiftCardsService,
    private readonly auditService: AuditService,
  ) {}

  // ============================================
  // DASHBOARD & STATS
  // ============================================

  /**
   * Get admin dashboard statistics
   */
  async getDashboardStats(): Promise<any> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // User stats
    const totalUsers = await this.userModel.countDocuments({
      isDeleted: false,
    });
    const activeUsers = await this.userModel.countDocuments({
      isDeleted: false,
      status: UserStatus.ACTIVE,
    });
    const newUsersToday = await this.userModel.countDocuments({
      createdAt: { $gte: today },
    });

    // Wallet stats
    const walletAgg = await this.walletModel.aggregate([
      { $group: { _id: null, totalBalance: { $sum: "$balance" } } },
    ]);
    const totalWalletBalance = walletAgg[0]?.totalBalance || 0;

    // Trade stats
    const totalTrades = await this.tradeModel.countDocuments();
    const pendingTrades = await this.tradeModel.countDocuments({
      status: TradeStatus.PENDING,
    });
    const tradesToday = await this.tradeModel.countDocuments({
      createdAt: { $gte: today },
    });

    // VTU stats
    const totalAirtime = await this.airtimeModel.countDocuments();
    const totalData = await this.dataModel.countDocuments();
    const airtimeToday = await this.airtimeModel.countDocuments({
      createdAt: { $gte: today },
    });
    const dataToday = await this.dataModel.countDocuments({
      createdAt: { $gte: today },
    });

    // Paystack topups
    const totalTopups = await this.paystackModel.countDocuments({
      status: "SUCCESS",
    });

    // Revenue (approved trades + successful VTU)
    const tradeRevenueAgg = await this.tradeModel.aggregate([
      {
        $match: {
          status: TradeStatus.APPROVED,
          reviewedAt: { $gte: today },
        },
      },
      { $group: { _id: null, total: { $sum: "$amountNgn" } } },
    ]);

    return {
      totalUsers,
      activeUsers,
      newUsersToday,
      totalWalletBalance: toNaira(totalWalletBalance),
      totalTrades,
      pendingTrades,
      tradesToday,
      totalTopups,
      totalAirtime,
      totalData,
      vtuToday: airtimeToday + dataToday,
      revenueToday: toNaira(tradeRevenueAgg[0]?.total || 0),
    };
  }

  /**
   * Get recent activity for dashboard
   */
  async getDashboardRecent(): Promise<any> {
    const [recentTrades, recentTransactions] = await Promise.all([
      this.tradeModel
        .find()
        .populate("userId", "email phone fullName")
        .populate("brandId", "name logo")
        .populate("categoryId", "name currency")
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
      this.walletTransactionModel
        .find()
        .populate("userId", "email phone fullName")
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
    ]);

    return {
      recentTrades: recentTrades.map((trade) => ({
        ...trade,
        amountNaira: toNaira(trade.amountNgn || 0),
      })),
      recentTransactions: recentTransactions.map((txn) => ({
        ...txn,
        amountNaira: toNaira(txn.amount || 0),
      })),
    };
  }

  // ============================================
  // USER MANAGEMENT
  // ============================================

  /**
   * Get all users with filters
   */
  async getUsers(query: UsersQueryDto): Promise<PaginatedResult<User>> {
    const filter: any = { isDeleted: false };

    if (query.status) {
      filter.status = query.status;
    }

    if (query.isEmailVerified !== undefined) {
      filter.isEmailVerified = query.isEmailVerified;
    }

    if (query.hasPinSet !== undefined) {
      if (query.hasPinSet) {
        filter.transactionPinHash = { $ne: null };
      } else {
        filter.transactionPinHash = null;
      }
    }

    if (query.search) {
      filter.$or = [
        { email: { $regex: query.search, $options: "i" } },
        { phone: { $regex: query.search, $options: "i" } },
        { fullName: { $regex: query.search, $options: "i" } },
      ];
    }

    const total = await this.userModel.countDocuments(filter);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const users = await this.userModel
      .find(filter)
      .select("-passwordHash -transactionPinHash")
      .sort({ createdAt: -1 })
      .skip(calculateSkip(page, limit))
      .limit(limit);

    return paginate(users, total, page, limit);
  }

  /**
   * Get user details by ID
   */
  async getUserById(userId: string): Promise<any> {
    const user = await this.userModel
      .findById(userId)
      .select("-passwordHash -transactionPinHash");

    if (!user) {
      throw new NotFoundException("User not found");
    }

    // Get wallet info
    const wallet = await this.walletModel.findOne({
      userId: new Types.ObjectId(userId),
    });

    // Get recent transactions
    const recentTransactions = await this.walletTransactionModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(10);

    // Get trade count
    const tradeCount = await this.tradeModel.countDocuments({
      userId: new Types.ObjectId(userId),
    });

    return {
      user,
      wallet: wallet
        ? {
            balance: toNaira(wallet.balance),
            status: wallet.status,
            lastTransactionAt: wallet.lastTransactionAt,
          }
        : null,
      recentTransactions: recentTransactions.map((t) => ({
        ...t.toObject(),
        amountNaira: toNaira(t.amount),
      })),
      stats: {
        tradeCount,
      },
    };
  }

  /**
   * Update user status (suspend/reactivate)
   */
  async updateUserStatus(
    userId: string,
    adminId: string,
    dto: UpdateUserStatusDto,
  ): Promise<User> {
    const user = await this.userModel.findById(userId);

    if (!user) {
      throw new NotFoundException("User not found");
    }

    const previousStatus = user.status;
    user.status = dto.status as UserStatus;
    await user.save();

    this.logger.log(
      `User ${userId} status changed to ${dto.status} by admin ${adminId}. Reason: ${dto.reason}`,
    );

    // Audit log
    this.auditService.logAdminAction(
      adminId,
      AuditAction.ADMIN_USER_STATUS_CHANGED,
      AuditResource.USER,
      userId,
      `User status changed from ${previousStatus} to ${dto.status}. Reason: ${dto.reason}`,
      {
        previousValues: { status: previousStatus },
        newValues: { status: dto.status },
        meta: { reason: dto.reason, userEmail: user.email },
      },
    );

    return user;
  }

  /**
   * Update user details (admin edit)
   */
  async updateUserDetails(
    userId: string,
    adminId: string,
    dto: UpdateUserDetailsDto,
  ): Promise<User> {
    const user = await this.userModel.findById(userId);

    if (!user) {
      throw new NotFoundException("User not found");
    }

    const previousValues: any = {};
    const newValues: any = {};

    if (dto.fullName !== undefined) {
      previousValues.fullName = user.fullName;
      newValues.fullName = dto.fullName;
      user.fullName = dto.fullName;
    }

    if (dto.email !== undefined) {
      previousValues.email = user.email;
      newValues.email = dto.email;
      user.email = dto.email;
    }

    if (dto.phone !== undefined) {
      previousValues.phone = user.phone;
      newValues.phone = dto.phone;
      user.phone = dto.phone;
    }

    if (dto.status !== undefined) {
      previousValues.status = user.status;
      newValues.status = dto.status;
      user.status = dto.status as UserStatus;
    }

    await user.save();

    this.logger.log(
      `User ${userId} details updated by admin ${adminId}`,
    );

    // Audit log
    this.auditService.logAdminAction(
      adminId,
      AuditAction.ADMIN_USER_STATUS_CHANGED,
      AuditResource.USER,
      userId,
      `User details updated by admin`,
      {
        previousValues,
        newValues,
        meta: { userEmail: user.email },
      },
    );

    return user;
  }

  // ============================================
  // WALLET MANAGEMENT
  // ============================================

  /**
   * Get all wallet transactions with filters (admin view - no userId required)
   */
  async getAllWalletTransactions(
    query: TransactionsQueryDto,
  ): Promise<PaginatedResult<WalletTransaction>> {
    const filter: any = {};

    if (query.type) {
      filter.type = query.type;
    }

    if (query.category) {
      filter.category = query.category;
    }

    if (query.status) {
      filter.status = query.status;
    }

    if (query.startDate || query.endDate) {
      filter.createdAt = {};
      if (query.startDate) {
        filter.createdAt.$gte = new Date(query.startDate);
      }
      if (query.endDate) {
        filter.createdAt.$lte = new Date(query.endDate);
      }
    }

    if (query.search) {
      filter.$or = [
        { reference: { $regex: query.search, $options: "i" } },
        { narration: { $regex: query.search, $options: "i" } },
      ];
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const total = await this.walletTransactionModel.countDocuments(filter);
    const transactions = await this.walletTransactionModel
      .find(filter)
      .populate("userId", "email phone fullName")
      .sort({ createdAt: -1 })
      .skip(calculateSkip(page, limit))
      .limit(limit);

    // Map transactions with Naira conversions
    const mappedTransactions = transactions.map((t) => ({
      ...t.toObject(),
      amountNaira: toNaira(t.amount),
      balanceBeforeNaira: toNaira(t.balanceBefore ?? 0),
      balanceAfterNaira: toNaira(t.balanceAfter ?? 0),
    }));

    return paginate(mappedTransactions, total, page, limit);
  }
  /**
   * Get wallet transactions for a specific user (admin view)
   */
  async getUserWalletTransactions(
    userId: string,
    query: TransactionsQueryDto,
  ): Promise<PaginatedResult<WalletTransaction>> {
    const filter: any = { userId: new Types.ObjectId(userId) };

    if (query.type) {
      filter.type = query.type;
    }

    if (query.category) {
      filter.category = query.category;
    }

    if (query.status) {
      filter.status = query.status;
    }

    if (query.startDate || query.endDate) {
      filter.createdAt = {};
      if (query.startDate) {
        filter.createdAt.$gte = new Date(query.startDate);
      }
      if (query.endDate) {
        filter.createdAt.$lte = new Date(query.endDate);
      }
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const total = await this.walletTransactionModel.countDocuments(filter);
    const transactions = await this.walletTransactionModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(calculateSkip(page, limit))
      .limit(limit);

    const mappedTransactions = transactions.map((t) => ({
      ...t.toObject(),
      amountNaira: toNaira(t.amount),
    }));

    return paginate(mappedTransactions, total, page, limit);
  }

  /**
   * Get single wallet transaction by ID
   */
  async getWalletTransactionById(id: string): Promise<any> {
    const transaction = await this.walletTransactionModel
      .findById(id)
      .populate("userId", "email phone fullName");

    if (!transaction) {
      throw new NotFoundException("Wallet transaction not found");
    }

    return {
      ...transaction.toObject(),
      amountNaira: toNaira(transaction.amount),
      balanceBeforeNaira: toNaira(transaction.balanceBefore ?? 0),
      balanceAfterNaira: toNaira(transaction.balanceAfter ?? 0),
    };
  }

  /**
   * Manual wallet adjustment (credit/debit)
   */
  async manualWalletAdjustment(
    adminId: string,
    dto: ManualWalletAdjustmentDto,
  ): Promise<WalletTransaction> {
    const user = await this.userModel.findById(dto.userId);
    if (!user) {
      throw new NotFoundException("User not found");
    }

    const reference = dto.internalReference || generateReference("ADJ");
    const amountKobo = toKobo(dto.amount);

    let transaction: WalletTransaction;

    if (dto.type === AdjustmentType.CREDIT) {
      transaction = await this.walletService.creditWallet({
        userId: dto.userId,
        amount: amountKobo,
        category: TransactionCategory.MANUAL,
        source: TransactionSource.MANUAL_ADJUSTMENT,
        reference,
        narration: `Admin adjustment: ${dto.reason}`,
        meta: {
          adminId,
          adjustmentType: "CREDIT",
          reason: dto.reason,
        },
      });
    } else {
      transaction = await this.walletService.debitWallet({
        userId: dto.userId,
        amount: amountKobo,
        category: TransactionCategory.MANUAL,
        source: TransactionSource.MANUAL_ADJUSTMENT,
        reference,
        narration: `Admin adjustment: ${dto.reason}`,
        meta: {
          adminId,
          adjustmentType: "DEBIT",
          reason: dto.reason,
        },
      });
    }

    this.logger.log(
      `Admin ${adminId} made ${dto.type} adjustment of NGN ${dto.amount} for user ${dto.userId}. Reason: ${dto.reason}`,
    );

    // Audit log
    this.auditService.logAdminAction(
      adminId,
      AuditAction.ADMIN_WALLET_ADJUSTMENT,
      AuditResource.WALLET,
      dto.userId,
      `Manual ${dto.type} of ₦${dto.amount} for user ${dto.userId}. Reason: ${dto.reason}`,
      {
        meta: {
          adjustmentType: dto.type,
          amount: dto.amount,
          amountKobo: amountKobo,
          reference,
          reason: dto.reason,
          userEmail: user.email,
        },
      },
    );

    return transaction;
  }

  // ============================================
  // GIFT CARD TRADE MANAGEMENT
  // ============================================

  /**
   * Get all trades (admin view)
   */
  async getTrades(
    query: TradeQueryDto,
  ): Promise<PaginatedResult<GiftCardTrade>> {
    return this.giftCardsService.getAllTrades(query);
  }

  /**
   * Get a single trade by ID
   */
  async getTradeById(tradeId: string): Promise<GiftCardTrade> {
    return this.giftCardsService.getTradeById(tradeId);
  }

  /**
   * Review/approve/reject a trade
   */
  async reviewTrade(
    tradeId: string,
    adminId: string,
    dto: ReviewTradeDto,
  ): Promise<GiftCardTrade> {
    const result = await this.giftCardsService.reviewTrade(tradeId, adminId, dto);

    // Audit log
    const action = dto.status === 'APPROVED'
      ? AuditAction.GIFTCARD_TRADE_APPROVED
      : dto.status === 'REJECTED'
        ? AuditAction.GIFTCARD_TRADE_REJECTED
        : AuditAction.GIFTCARD_TRADE_SUBMITTED;

    this.auditService.logAdminAction(
      adminId,
      action,
      AuditResource.GIFTCARD_TRADE,
      tradeId,
      `Trade ${tradeId} reviewed: ${dto.status}${dto.rejectionReason ? ` — ${dto.rejectionReason}` : ''}`,
      {
        newValues: { status: dto.status },
        meta: {
          rejectionReason: dto.rejectionReason,
          adjustedAmountNgn: dto.adjustedAmountNgn,
        },
      },
    );

    return result;
  }

  /**
   * Get trade statistics
   */
  async getTradeStats(): Promise<any> {
    return this.giftCardsService.getTradeStats();
  }

  // ============================================
  // VTU MANAGEMENT
  // ============================================

  /**
   * Get VTU transactions (airtime + data)
   */
  async getVtuTransactions(query: VtuQueryDto): Promise<any> {
    const buildFilter = (query: VtuQueryDto): any => {
      const filter: any = {};

      if (query.userId) {
        filter.userId = new Types.ObjectId(query.userId);
      }

      if (query.status) {
        filter.status = query.status;
      }

      if (query.network) {
        filter.network = query.network;
      }

      if (query.search) {
        filter.$or = [
          { reference: { $regex: query.search, $options: "i" } },
          { phone: { $regex: query.search, $options: "i" } },
        ];
      }

      if (query.startDate || query.endDate) {
        filter.createdAt = {};
        if (query.startDate) {
          filter.createdAt.$gte = new Date(query.startDate);
        }
        if (query.endDate) {
          filter.createdAt.$lte = new Date(query.endDate);
        }
      }

      return filter;
    };

    const filter = buildFilter(query);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    // If type specified, return only that type
    if (query.type === VtuTransactionType.AIRTIME) {
      const total = await this.airtimeModel.countDocuments(filter);
      const items = await this.airtimeModel
        .find(filter)
        .populate("userId", "email phone fullName")
        .sort({ createdAt: -1 })
        .skip(calculateSkip(page, limit))
        .limit(limit);

      return {
        type: "AIRTIME",
        ...paginate(items, total, page, limit),
      };
    }

    if (query.type === VtuTransactionType.DATA) {
      const total = await this.dataModel.countDocuments(filter);
      const items = await this.dataModel
        .find(filter)
        .populate("userId", "email phone fullName")
        .sort({ createdAt: -1 })
        .skip(calculateSkip(page, limit))
        .limit(limit);

      return {
        type: "DATA",
        ...paginate(items, total, page, limit),
      };
    }

    // Return both types combined
    const [airtimeItems, dataItems, airtimeTotal, dataTotal] =
      await Promise.all([
        this.airtimeModel
          .find(filter)
          .populate("userId", "email phone fullName")
          .sort({ createdAt: -1 })
          .skip(calculateSkip(page, limit))
          .limit(limit),
        this.dataModel
          .find(filter)
          .populate("userId", "email phone fullName")
          .sort({ createdAt: -1 })
          .skip(calculateSkip(page, limit))
          .limit(limit),
        this.airtimeModel.countDocuments(filter),
        this.dataModel.countDocuments(filter),
      ]);

    // Combine and sort
    const combined = [
      ...airtimeItems.map((a) => ({ ...a.toObject(), vtuType: "AIRTIME" })),
      ...dataItems.map((d) => ({ ...d.toObject(), vtuType: "DATA" })),
    ].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    const total = airtimeTotal + dataTotal;

    return {
      type: "ALL",
      data: combined.slice(0, limit),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get single VTU transaction details
   */
  async getVtuTransaction(id: string, type: VtuTransactionType): Promise<any> {
    if (type === VtuTransactionType.AIRTIME) {
      const transaction = await this.airtimeModel
        .findById(id)
        .populate("userId", "email phone fullName");

      if (!transaction) {
        throw new NotFoundException("Airtime transaction not found");
      }

      return {
        type: "AIRTIME",
        transaction: {
          ...transaction.toObject(),
          amountNaira: toNaira(transaction.amount),
        },
      };
    }

    const transaction = await this.dataModel
      .findById(id)
      .populate("userId", "email phone fullName");

    if (!transaction) {
      throw new NotFoundException("Data transaction not found");
    }

    return {
      type: "DATA",
      transaction: {
        ...transaction.toObject(),
        amountNaira: toNaira(transaction.amount),
      },
    };
  }

  /**
   * Manual refund for failed VTU transaction
   */
  async manualVtuRefund(
    id: string,
    type: VtuTransactionType,
    adminId: string,
    dto: ManualVtuRefundDto,
  ): Promise<any> {
    const session = await this.connection.startSession();
    session.startTransaction();

    try {
      let transaction: any;

      if (type === VtuTransactionType.AIRTIME) {
        transaction = await this.airtimeModel.findById(id).session(session);
      } else {
        transaction = await this.dataModel.findById(id).session(session);
      }

      if (!transaction) {
        throw new NotFoundException("Transaction not found");
      }

      if (transaction.status === "SUCCESS") {
        throw new BadRequestException("Cannot refund successful transaction");
      }

      if (transaction.status === "REFUNDED") {
        throw new BadRequestException("Transaction already refunded");
      }

      // Credit the wallet
      const reference = generateReference("REFUND");
      await this.walletService.creditWallet({
        userId: transaction.userId.toString(),
        amount: transaction.amount,
        category: TransactionCategory.MANUAL,
        source: TransactionSource.MANUAL_ADJUSTMENT,
        reference,
        narration: `Manual refund for ${type} transaction ${transaction.reference}: ${dto.reason}`,
        meta: {
          originalTransactionId: id,
          originalReference: transaction.reference,
          adminId,
          reason: dto.reason,
        },
        session,
      });

      // Update transaction status
      transaction.status = "REFUNDED";
      transaction.meta = {
        ...transaction.meta,
        refundedAt: new Date(),
        refundedBy: adminId,
        refundReason: dto.reason,
        refundReference: reference,
      };
      await transaction.save({ session });

      await session.commitTransaction();

      this.logger.log(
        `Admin ${adminId} refunded ${type} transaction ${id}. Reason: ${dto.reason}`,
      );

      // Audit log
      this.auditService.logAdminAction(
        adminId,
        AuditAction.ADMIN_VTU_REFUND,
        type === VtuTransactionType.AIRTIME ? AuditResource.VTU_AIRTIME : AuditResource.VTU_DATA,
        id,
        `Manual ${type} refund for transaction ${transaction.reference}. Reason: ${dto.reason}`,
        {
          meta: {
            transactionType: type,
            amount: transaction.amount,
            reference: transaction.reference,
            refundReference: reference,
            reason: dto.reason,
            userId: transaction.userId.toString(),
          },
        },
      );

      return {
        ...transaction.toObject(),
        amountNaira: toNaira(transaction.amount),
      };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  // ============================================
  // PAYSTACK MANAGEMENT
  // ============================================

  /**
   * Get Paystack transactions
   */
  async getPaystackTransactions(
    query: PaystackQueryDto,
  ): Promise<PaginatedResult<PaystackTransaction>> {
    const filter: any = {};

    if (query.userId) {
      filter.userId = new Types.ObjectId(query.userId);
    }

    if (query.status) {
      filter.status = query.status;
    }

    if (query.search) {
      filter.reference = { $regex: query.search, $options: "i" };
    }

    if (query.startDate || query.endDate) {
      filter.createdAt = {};
      if (query.startDate) {
        filter.createdAt.$gte = new Date(query.startDate);
      }
      if (query.endDate) {
        filter.createdAt.$lte = new Date(query.endDate);
      }
    }

    const total = await this.paystackModel.countDocuments(filter);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const transactions = await this.paystackModel
      .find(filter)
      .populate("userId", "email phone fullName")
      .sort({ createdAt: -1 })
      .skip(calculateSkip(page, limit))
      .limit(limit);

    const mappedTransactions = transactions.map((t) => ({
      ...t.toObject(),
      amountNaira: toNaira(t.amount),
    }));

    return paginate(mappedTransactions, total, page, limit);
  }

  /**
   * Get single Paystack transaction
   */
  async getPaystackTransaction(id: string): Promise<any> {
    const transaction = await this.paystackModel
      .findById(id)
      .populate("userId", "email phone fullName");

    if (!transaction) {
      throw new NotFoundException("Paystack transaction not found");
    }

    return {
      ...transaction.toObject(),
      amountNaira: toNaira(transaction.amount),
    };
  }
  async getVtuStats(): Promise<any> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Reusable pipeline: compute provider cost & profit per record, then sum
    const revenuePipeline = (matchFilter: Record<string, any>) => [
      { $match: matchFilter },
      {
        $addFields: {
          computedProviderCost: {
            $cond: {
              if: { $gt: ["$providerCost", 0] }, // new schema field
              then: "$providerCost",
              else: {
                $cond: {
                  if: { $ifNull: ["$providerResponse.merchant_amount", false] },
                  then: { $toDouble: "$providerResponse.merchant_amount" }, // old records
                  else: 0,
                },
              },
            },
          },
        },
      },
      {
        $addFields: {
          computedProfit: {
            $cond: {
              if: { $gt: ["$profit", 0] }, // new schema field
              then: "$profit",
              else: { $subtract: ["$amount", "$computedProviderCost"] },
            },
          },
        },
      },
      {
        $group: {
          _id: null,
          totalAmount: { $sum: "$amount" },
          totalProviderCost: { $sum: "$computedProviderCost" },
          totalProfit: { $sum: "$computedProfit" },
          count: { $sum: 1 },
        },
      },
    ];

    // By-network pipeline
    const networkPipeline = (matchFilter: Record<string, any>) => [
      { $match: matchFilter },
      {
        $addFields: {
          computedProviderCost: {
            $cond: {
              if: { $gt: ["$providerCost", 0] },
              then: "$providerCost",
              else: {
                $cond: {
                  if: { $ifNull: ["$providerResponse.merchant_amount", false] },
                  then: { $toDouble: "$providerResponse.merchant_amount" },
                  else: 0,
                },
              },
            },
          },
        },
      },
      {
        $addFields: {
          computedProfit: {
            $cond: {
              if: { $gt: ["$profit", 0] },
              then: "$profit",
              else: { $subtract: ["$amount", "$computedProviderCost"] },
            },
          },
        },
      },
      {
        $group: {
          _id: "$network",
          totalAmount: { $sum: "$amount" },
          totalProviderCost: { $sum: "$computedProviderCost" },
          totalProfit: { $sum: "$computedProfit" },
          count: { $sum: 1 },
        },
      },
      { $sort: { totalProfit: -1 as 1 | -1 } },
    ];

    const successFilter = { status: "SUCCESS" };
    const successTodayFilter = {
      status: "SUCCESS",
      createdAt: { $gte: today },
    };

    const [
      // Revenue aggregations (SUCCESS only — profit only counts on delivered txns)
      airtimeAll,
      airtimeToday,
      airtimeByNetwork,
      dataAll,
      dataToday,
      dataByNetwork,
      // Status counts
      airtimeTotal,
      airtimeSuccess,
      airtimePending,
      airtimeFailed,
      airtimeRefunded,
      dataTotal,
      dataSuccess,
      dataPending,
      dataFailed,
      dataRefunded,
      // Today counts (all statuses)
      airtimeTodayCount,
      dataTodayCount,
    ] = await Promise.all([
      this.airtimeModel.aggregate(revenuePipeline(successFilter)),
      this.airtimeModel.aggregate(revenuePipeline(successTodayFilter)),
      this.airtimeModel.aggregate(networkPipeline(successFilter)),
      this.dataModel.aggregate(revenuePipeline(successFilter)),
      this.dataModel.aggregate(revenuePipeline(successTodayFilter)),
      this.dataModel.aggregate(networkPipeline(successFilter)),
      // Counts
      this.airtimeModel.countDocuments(),
      this.airtimeModel.countDocuments({ status: "SUCCESS" }),
      this.airtimeModel.countDocuments({ status: "PENDING" }),
      this.airtimeModel.countDocuments({ status: "FAILED" }),
      this.airtimeModel.countDocuments({ status: "REFUNDED" }),
      this.dataModel.countDocuments(),
      this.dataModel.countDocuments({ status: "SUCCESS" }),
      this.dataModel.countDocuments({ status: "PENDING" }),
      this.dataModel.countDocuments({ status: "FAILED" }),
      this.dataModel.countDocuments({ status: "REFUNDED" }),
      this.airtimeModel.countDocuments({ createdAt: { $gte: today } }),
      this.dataModel.countDocuments({ createdAt: { $gte: today } }),
    ]);

    // Default zeros
    const air = airtimeAll[0] || {
      totalAmount: 0,
      totalProviderCost: 0,
      totalProfit: 0,
      count: 0,
    };
    const airDay = airtimeToday[0] || {
      totalAmount: 0,
      totalProviderCost: 0,
      totalProfit: 0,
      count: 0,
    };
    const dat = dataAll[0] || {
      totalAmount: 0,
      totalProviderCost: 0,
      totalProfit: 0,
      count: 0,
    };
    const datDay = dataToday[0] || {
      totalAmount: 0,
      totalProviderCost: 0,
      totalProfit: 0,
      count: 0,
    };

    return {
      // Combined totals
      totalTransactions: airtimeTotal + dataTotal,
      totalTransactionsToday: airtimeTodayCount + dataTodayCount,
      totalAmount: air.totalAmount + dat.totalAmount,
      totalProviderCost: air.totalProviderCost + dat.totalProviderCost,
      totalProfit: air.totalProfit + dat.totalProfit,

      // Today
      todayAmount: airDay.totalAmount + datDay.totalAmount,
      todayProviderCost: airDay.totalProviderCost + datDay.totalProviderCost,
      todayProfit: airDay.totalProfit + datDay.totalProfit,
      todayTransactions: airDay.count + datDay.count,

      // Airtime breakdown
      airtime: {
        total: airtimeTotal,
        success: airtimeSuccess,
        pending: airtimePending,
        failed: airtimeFailed,
        refunded: airtimeRefunded,
        todayCount: airtimeTodayCount,
        totalAmount: air.totalAmount,
        totalProviderCost: air.totalProviderCost,
        totalProfit: air.totalProfit,
        today: {
          amount: airDay.totalAmount,
          providerCost: airDay.totalProviderCost,
          profit: airDay.totalProfit,
          count: airDay.count,
        },
        byNetwork: airtimeByNetwork.map((n: any) => ({
          network: n._id,
          totalAmount: n.totalAmount,
          totalProviderCost: n.totalProviderCost,
          totalProfit: n.totalProfit,
          count: n.count,
        })),
      },

      // Data breakdown
      data: {
        total: dataTotal,
        success: dataSuccess,
        pending: dataPending,
        failed: dataFailed,
        refunded: dataRefunded,
        todayCount: dataTodayCount,
        totalAmount: dat.totalAmount,
        totalProviderCost: dat.totalProviderCost,
        totalProfit: dat.totalProfit,
        today: {
          amount: datDay.totalAmount,
          providerCost: datDay.totalProviderCost,
          profit: datDay.totalProfit,
          count: datDay.count,
        },
        byNetwork: dataByNetwork.map((n: any) => ({
          network: n._id,
          totalAmount: n.totalAmount,
          totalProviderCost: n.totalProviderCost,
          totalProfit: n.totalProfit,
          count: n.count,
        })),
      },

      // Status counts (combined)
      statusCounts: {
        success: airtimeSuccess + dataSuccess,
        pending: airtimePending + dataPending,
        failed: airtimeFailed + dataFailed,
        refunded: airtimeRefunded + dataRefunded,
      },
    };
  }
}
