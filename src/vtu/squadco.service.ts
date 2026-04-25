/**
 * SquadCo Service
 *
 * Handles VTU business logic for airtime and data purchases.
 * Delegates API calls to VtpassService.
 * - Fetches data plans dynamically from VTPass API with caching
 * - Networks are hardcoded (provider doesn't offer a networks endpoint)
 * - Includes wallet debit/refund logic and purchase history
 */
import {
  Injectable,
  Logger,
  InternalServerErrorException,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { InjectModel, InjectConnection } from "@nestjs/mongoose";
import { Model, Connection, Types } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { VtpassService } from "./vtpass.service";
import {
  AirtimePurchase,
  AirtimePurchaseDocument,
  DataPurchase,
  DataPurchaseDocument,
  VtuNetwork,
  VtuPurchaseStatus,
} from "./schemas/vtu-purchase.schema";
import {
  DataPlanResponseDto,
  PurchaseAirtimeDto,
  PurchaseDataDto,
} from "./dto";
import { WalletService } from "../wallet/wallet.service";
import {
  TransactionCategory,
  TransactionSource,
} from "../wallet/schemas/wallet-transaction.schema";

export interface SquadCoResponse {
  success: boolean;
  transactionId?: string;
  message?: string;
  data?: any;
}

/** Network info for frontend */
export interface NetworkResponse {
  code: string;
  name: string;
  logo: string | null;
  airtimeAvailable: boolean;
  dataAvailable: boolean;
}

@Injectable()
export class SquadCoService {
  private readonly logger = new Logger(SquadCoService.name);

  // Cache for data plans (refresh every 30 minutes)
  private dataPlanCache: Map<
    string,
    { plans: DataPlanResponseDto[]; timestamp: number }
  > = new Map();
  private readonly CACHE_TTL = 30 * 60 * 1000; // 30 minutes

  // Hardcoded networks (provider doesn't offer a networks endpoint)
  private readonly networks: NetworkResponse[] = [
    {
      code: VtuNetwork.MTN,
      name: "MTN Nigeria",
      logo: null,
      airtimeAvailable: true,
      dataAvailable: true,
    },
    {
      code: VtuNetwork.GLO,
      name: "Glo Nigeria",
      logo: null,
      airtimeAvailable: true,
      dataAvailable: true,
    },
    {
      code: VtuNetwork.AIRTEL,
      name: "Airtel Nigeria",
      logo: null,
      airtimeAvailable: true,
      dataAvailable: true,
    },
    {
      code: VtuNetwork.ETISALAT,
      name: "9Mobile Nigeria",
      logo: null,
      airtimeAvailable: true,
      dataAvailable: true,
    },
  ];

  constructor(
    @InjectModel(AirtimePurchase.name)
    private readonly airtimeModel: Model<AirtimePurchaseDocument>,
    @InjectModel(DataPurchase.name)
    private readonly dataModel: Model<DataPurchaseDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly walletService: WalletService,
    private readonly vtpassService: VtpassService,
  ) {}

  /**
   * Get supported networks (hardcoded)
   */
  getNetworks(): NetworkResponse[] {
    return this.networks;
  }

  /**
   * Get data plans for a network - fetches from VTPass API with caching
   */
  async getDataPlans(network: string): Promise<DataPlanResponseDto[]> {
    const networkUpper = network.toUpperCase();

    // Validate network
    if (
      !["MTN", "GLO", "AIRTEL", "9MOBILE", "ETISALAT"].includes(networkUpper)
    ) {
      throw new BadRequestException(`Invalid network: ${network}`);
    }

    // Normalise 9MOBILE → ETISALAT for internal consistency
    const normalizedNetwork =
      networkUpper === "9MOBILE"
        ? VtuNetwork.ETISALAT
        : (networkUpper as VtuNetwork);

    // Check cache first
    const cached = this.dataPlanCache.get(normalizedNetwork);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      this.logger.debug(`Returning cached data plans for ${normalizedNetwork}`);
      return cached.plans;
    }

    try {
      this.logger.log(`Fetching data plans from VTPass for ${normalizedNetwork}`);

      const vtpassPlans = await this.vtpassService.getDataPlans(normalizedNetwork);

      if (!vtpassPlans.length) {
        throw new NotFoundException(`No data plans available for ${network}`);
      }

      const plans: DataPlanResponseDto[] = vtpassPlans.map((p) => ({
        planCode: p.planCode,
        name: p.name,
        dataAmount: p.dataAmount,
        validity: p.validity,
        price: p.price,
        network: normalizedNetwork,
      }));

      // Sort by price
      plans.sort((a, b) => a.price - b.price);

      // Cache the result
      this.dataPlanCache.set(normalizedNetwork, {
        plans,
        timestamp: Date.now(),
      });

      this.logger.log(`Cached ${plans.length} data plans for ${normalizedNetwork}`);
      return plans;
    } catch (error: any) {
      if (error.status) {
        throw error;
      }

      // Return stale cache if available
      if (cached) {
        this.logger.warn(
          `VTPass API failed, returning stale cache for ${normalizedNetwork}`,
        );
        return cached.plans;
      }

      this.logger.error(`Failed to fetch data plans: ${error.message}`);
      throw new InternalServerErrorException(
        "Failed to fetch data plans from provider",
      );
    }
  }

  /**
   * Get a specific data plan by code
   */
  async getDataPlanByCode(
    network: string,
    planCode: string,
  ): Promise<DataPlanResponseDto | null> {
    const plans = await this.getDataPlans(network);
    return plans.find((p) => p.planCode === planCode) || null;
  }

  /**
   * Clear data plan cache (useful for admin/testing)
   */
  clearCache(): void {
    this.dataPlanCache.clear();
    this.logger.log("Data plan cache cleared");
  }

  /**
   * Detect network from phone number (public method for controller)
   */
  getNetworkFromPhone(
    phone: string,
  ): { network: VtuNetwork; networkName: string } | null {
    const detectedNetwork = this.detectNetworkFromPhone(phone);

    if (!detectedNetwork) {
      return null;
    }

    const networkNames: Record<VtuNetwork, string> = {
      [VtuNetwork.MTN]: "MTN",
      [VtuNetwork.GLO]: "Glo",
      [VtuNetwork.AIRTEL]: "Airtel",
      [VtuNetwork.ETISALAT]: "9mobile",
    };

    return {
      network: detectedNetwork,
      networkName: networkNames[detectedNetwork],
    };
  }

  /**
   * Purchase airtime - main entry point with wallet debit
   */
  async purchaseAirtime(
    userId: string,
    dto: PurchaseAirtimeDto,
  ): Promise<AirtimePurchaseDocument> {
    this.validatePhoneNetwork(dto.phone, dto.network as VtuNetwork);

    const session = await this.connection.startSession();
    session.startTransaction();

    const reference = this.generateReference("AIR");
    let purchaseDoc: AirtimePurchaseDocument | null = null;

    try {
      // 1. Create pending purchase record
      const [createdPurchase] = await this.airtimeModel.create(
        [
          {
            userId: new Types.ObjectId(userId),
            network: dto.network,
            phoneNumber: dto.phone,
            amount: dto.amount,
            reference,
            status: VtuPurchaseStatus.PENDING,
          },
        ],
        { session },
      );
      purchaseDoc = createdPurchase;

      // 2. Debit wallet
      const walletTxn = await this.walletService.debitWallet({
        userId,
        amount: dto.amount * 100,
        category: TransactionCategory.AIRTIME,
        source: TransactionSource.VTU_VTPASS,
        reference,
        narration: `Airtime purchase: ${dto.network} - ${dto.phone}`,
        meta: {
          vtuType: "AIRTIME",
          network: dto.network,
          phoneNumber: dto.phone,
          purchaseId: purchaseDoc._id.toString(),
        },
        session,
      });

      purchaseDoc.walletTransactionId = (walletTxn as any)._id;
      await purchaseDoc.save({ session });

      // 3. Call VTPass API
      const phone = this.formatPhoneNumber(dto.phone);
      const result = await this.vtpassService.purchaseAirtime({
        network: dto.network,
        phone,
        amount: dto.amount,
        reference,
      });

      if (result.success) {
        purchaseDoc.status = VtuPurchaseStatus.SUCCESS;
        purchaseDoc.providerReference = result.transactionId || "";
        purchaseDoc.providerResponse = result.raw;
        await purchaseDoc.save({ session });

        await session.commitTransaction();
        this.logger.log(`Airtime purchase successful: ${reference}`);
        return purchaseDoc;
      } else {
        throw new BadRequestException("Airtime purchase failed");
      }
    } catch (error: any) {
      await session.abortTransaction();
      this.logger.error(`Airtime purchase failed: ${reference}`, error);

      if (purchaseDoc) {
        await this.airtimeModel.findByIdAndUpdate(purchaseDoc._id, {
          status: VtuPurchaseStatus.FAILED,
          failureReason: error.message,
        });
      }

      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Purchase data - main entry point with wallet debit
   */
  async purchaseData(
    userId: string,
    dto: PurchaseDataDto,
  ): Promise<DataPurchaseDocument> {
    this.validatePhoneNetwork(dto.phone, dto.network as VtuNetwork);

    const plan = await this.getDataPlanByCode(dto.network, dto.planCode);
    if (!plan) {
      throw new BadRequestException(`Invalid data plan code: ${dto.planCode}`);
    }

    const session = await this.connection.startSession();
    session.startTransaction();

    const reference = this.generateReference("DATA");
    let purchaseDoc: DataPurchaseDocument | null = null;

    try {
      // 1. Create pending purchase record
      const [createdPurchase] = await this.dataModel.create(
        [
          {
            userId: new Types.ObjectId(userId),
            network: dto.network,
            phoneNumber: dto.phone,
            planCode: dto.planCode,
            planName: plan.name,
            dataAmount: plan.dataAmount,
            validity: plan.validity,
            amount: plan.price,
            reference,
            status: VtuPurchaseStatus.PENDING,
          },
        ],
        { session },
      );
      purchaseDoc = createdPurchase;

      // 2. Debit wallet
      const walletTxn = await this.walletService.debitWallet({
        userId,
        amount: plan.price * 100,
        category: TransactionCategory.DATA,
        source: TransactionSource.VTU_VTPASS,
        reference,
        narration: `Data purchase: ${plan.dataAmount} ${dto.network} - ${dto.phone}`,
        meta: {
          vtuType: "DATA",
          network: dto.network,
          phoneNumber: dto.phone,
          planCode: dto.planCode,
          planName: plan.name,
          dataAmount: plan.dataAmount,
          purchaseId: purchaseDoc._id.toString(),
        },
        session,
      });

      purchaseDoc.walletTransactionId = (walletTxn as any)._id;
      await purchaseDoc.save({ session });

      // 3. Call VTPass API
      const phone = this.formatPhoneNumber(dto.phone);
      const result = await this.vtpassService.purchaseData({
        network: dto.network,
        phone,
        planCode: dto.planCode,
        amount: plan.price,
        reference,
      });

      if (result.success) {
        purchaseDoc.status = VtuPurchaseStatus.SUCCESS;
        purchaseDoc.providerReference = result.transactionId || "";
        purchaseDoc.providerResponse = result.raw;
        await purchaseDoc.save({ session });

        await session.commitTransaction();
        this.logger.log(`Data purchase successful: ${reference}`);
        return purchaseDoc;
      } else {
        throw new BadRequestException("Data purchase failed");
      }
    } catch (error: any) {
      await session.abortTransaction();
      this.logger.error(`Data purchase failed: ${reference}`, error);

      if (purchaseDoc) {
        await this.dataModel.findByIdAndUpdate(purchaseDoc._id, {
          status: VtuPurchaseStatus.FAILED,
          failureReason: error.message,
        });
      }

      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Get user's airtime purchase history
   */
  async getAirtimePurchases(
    userId: string,
    options: { page?: number; limit?: number } = {},
  ) {
    const { page = 1, limit = 10 } = options;
    const skip = (page - 1) * limit;

    const [purchases, total] = await Promise.all([
      this.airtimeModel
        .find({ userId: new Types.ObjectId(userId) })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.airtimeModel.countDocuments({ userId: new Types.ObjectId(userId) }),
    ]);

    return {
      data: purchases,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get user's data purchase history
   */
  async getDataPurchases(
    userId: string,
    options: { page?: number; limit?: number } = {},
  ) {
    const { page = 1, limit = 10 } = options;
    const skip = (page - 1) * limit;

    const [purchases, total] = await Promise.all([
      this.dataModel
        .find({ userId: new Types.ObjectId(userId) })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.dataModel.countDocuments({ userId: new Types.ObjectId(userId) }),
    ]);

    return {
      data: purchases,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get all VTU transactions (for admin)
   */
  async getAllTransactions(options: {
    type?: "AIRTIME" | "DATA";
    status?: string;
    userId?: string;
    network?: string;
    page?: number;
    limit?: number;
  }) {
    const { type, status, userId, network, page = 1, limit = 20 } = options;
    const skip = (page - 1) * limit;

    const filter: any = {};
    if (status) filter.status = status;
    if (userId) filter.userId = new Types.ObjectId(userId);
    if (network) filter.network = network;

    if (type === "AIRTIME") {
      const [data, total] = await Promise.all([
        this.airtimeModel
          .find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        this.airtimeModel.countDocuments(filter),
      ]);
      return {
        data: data.map((d) => ({ ...d, type: "AIRTIME" })),
        meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
      };
    }

    if (type === "DATA") {
      const [data, total] = await Promise.all([
        this.dataModel
          .find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        this.dataModel.countDocuments(filter),
      ]);
      return {
        data: data.map((d) => ({ ...d, type: "DATA" })),
        meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
      };
    }

    // Get both types
    const [airtime, data] = await Promise.all([
      this.airtimeModel.find(filter).sort({ createdAt: -1 }).lean(),
      this.dataModel.find(filter).sort({ createdAt: -1 }).lean(),
    ]);

    const combined = [
      ...airtime.map((a) => ({ ...a, type: "AIRTIME" as const })),
      ...data.map((d) => ({ ...d, type: "DATA" as const })),
    ].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    const total = combined.length;
    const paged = combined.slice(skip, skip + limit);

    return {
      data: paged,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Get a specific VTU transaction by ID (for admin)
   */
  async getTransactionById(type: "AIRTIME" | "DATA", id: string) {
    if (type === "AIRTIME") {
      const txn = await this.airtimeModel.findById(id).lean();
      if (!txn) {
        throw new NotFoundException("AIRTIME transaction not found");
      }
      return { ...txn, type };
    }

    const txn = await this.dataModel.findById(id).lean();
    if (!txn) {
      throw new NotFoundException("DATA transaction not found");
    }
    return { ...txn, type };
  }

  /**
   * Manual refund (for admin)
   */
  async manualRefund(
    type: "AIRTIME" | "DATA",
    id: string,
    adminId: string,
    reason: string,
  ) {
    const txnDoc =
      type === "AIRTIME"
        ? await this.airtimeModel.findById(id)
        : await this.dataModel.findById(id);

    if (!txnDoc) {
      throw new NotFoundException(`${type} transaction not found`);
    }

    if (txnDoc.status === VtuPurchaseStatus.REFUNDED) {
      throw new BadRequestException("Transaction already refunded");
    }

    if (txnDoc.status === VtuPurchaseStatus.SUCCESS) {
      throw new BadRequestException("Cannot refund successful transaction");
    }

    const session = await this.connection.startSession();
    session.startTransaction();

    try {
      await this.walletService.creditWallet({
        userId: txnDoc.userId.toString(),
        amount: txnDoc.amount * 100,
        category:
          type === "AIRTIME"
            ? TransactionCategory.AIRTIME
            : TransactionCategory.DATA,
        source: TransactionSource.VTU_VTPASS,
        reference: `REFUND_${txnDoc.reference}`,
        narration: `Refund: ${type} purchase ${txnDoc.reference}`,
        meta: {
          originalReference: txnDoc.reference,
          refundReason: reason,
          adminId,
        },
        session,
      });

      txnDoc.status = VtuPurchaseStatus.REFUNDED;
      txnDoc.refundedAt = new Date();
      txnDoc.refundReason = reason;
      await txnDoc.save({ session });

      await session.commitTransaction();
      this.logger.log(
        `Manual refund processed: ${txnDoc.reference} by admin ${adminId}`,
      );

      return txnDoc;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Nigerian phone number prefixes by network
   */
  private readonly NETWORK_PREFIXES: Record<VtuNetwork, string[]> = {
    [VtuNetwork.MTN]: [
      "0803", "0806", "0703", "0706", "0813", "0816",
      "0810", "0814", "0903", "0906", "0913", "0916",
      "07025", "07026",
    ],
    [VtuNetwork.GLO]: ["0805", "0807", "0705", "0815", "0811", "0905", "0915"],
    [VtuNetwork.AIRTEL]: [
      "0802", "0808", "0708", "0812", "0701",
      "0902", "0901", "0907", "0912",
    ],
    [VtuNetwork.ETISALAT]: ["0809", "0817", "0818", "0908", "0909"],
  };

  /**
   * Detect network from phone number prefix
   */
  private detectNetworkFromPhone(phone: string): VtuNetwork | null {
    const formattedPhone = this.formatPhoneNumber(phone);

    for (const [network, prefixes] of Object.entries(this.NETWORK_PREFIXES)) {
      for (const prefix of prefixes) {
        if (formattedPhone.startsWith(prefix)) {
          return network as VtuNetwork;
        }
      }
    }
    return null;
  }

  /**
   * Validate that phone number matches selected network
   */
  private validatePhoneNetwork(
    phone: string,
    selectedNetwork: VtuNetwork,
  ): void {
    const detectedNetwork = this.detectNetworkFromPhone(phone);

    if (!detectedNetwork) {
      throw new BadRequestException(
        "Unable to detect network from phone number. Please verify the number is correct.",
      );
    }

    if (detectedNetwork !== selectedNetwork) {
      const networkNames: Record<VtuNetwork, string> = {
        [VtuNetwork.MTN]: "MTN",
        [VtuNetwork.GLO]: "Glo",
        [VtuNetwork.AIRTEL]: "Airtel",
        [VtuNetwork.ETISALAT]: "9mobile",
      };

      throw new BadRequestException(
        `This phone number belongs to ${networkNames[detectedNetwork]}, not ${networkNames[selectedNetwork]}. Please select the correct network.`,
      );
    }
  }

  /**
   * Format phone number (11 digits, starts with 0)
   */
  private formatPhoneNumber(phone: string): string {
    phone = phone.replace(/[\s\-\+]/g, "");

    if (phone.startsWith("234") && phone.length === 13) {
      return "0" + phone.slice(3);
    }

    if (phone.startsWith("+234")) {
      return "0" + phone.slice(4);
    }

    if (phone.startsWith("0") && phone.length === 11) {
      return phone;
    }

    return phone;
  }

  /**
   * Generate unique reference
   */
  private generateReference(prefix: string): string {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = uuidv4().split("-")[0].toUpperCase();
    return `VTU_${prefix}_${timestamp}_${random}`;
  }
}
