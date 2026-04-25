/**
 * src/vtu/electricity.service.ts
 *
 * Service for electricity vending via VTPass API
 */
import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { InjectModel, InjectConnection } from "@nestjs/mongoose";
import { Model, Types, Connection } from "mongoose";
import { randomBytes } from "crypto";
import { VtpassService } from "./vtpass.service";
import {
  ElectricityPurchase,
  ElectricityPurchaseDocument,
  ElectricityPurchaseStatus,
  MeterType,
} from "./schemas/electricity-purchase.schema";
import { WalletService } from "../wallet/wallet.service";
import {
  TransactionCategory,
  TransactionSource,
  WalletTransactionDocument,
} from "../wallet/schemas/wallet-transaction.schema";
import {
  LookupMeterDto,
  PurchaseElectricityDto,
  GetElectricityPurchasesDto,
  MeterTypeEnum,
} from "./dto/electricity.dto";

// Provider info with regions
const PROVIDER_INFO: Record<string, { name: string; region: string }> = {
  IE: {
    name: "Ikeja Electricity",
    region: "Abule Egba, Akowonjo, Ikeja, Ikorodu, Oshodi and Shomolu in Lagos",
  },
  EKEDC: {
    name: "Eko Electricity",
    region:
      "Lekki, Ibeju, Islands, Ajah, Ajele, Orile, Ijora, Apapa, Mushin, Festac, Ojo, and Agbara in Lagos",
  },
  AEDC: {
    name: "Abuja Electricity",
    region: "FCT Abuja, Kogi, Niger, and Nasarawa States",
  },
  YEDC: {
    name: "Yola Electricity",
    region: "Adamawa, Taraba, Borno, and Yobe states",
  },
  BEDC: {
    name: "Benin Electricity",
    region: "Delta, Edo, Ekiti, and Ondo States",
  },
  IBEDC: {
    name: "Ibadan Electricity",
    region: "Oyo, Ibadan, Osun, Ogun & Kwara States",
  },
  KEDCO: {
    name: "Kano Electricity",
    region: "Kano, Katsina, and Jigawa States",
  },
  KAEDC: {
    name: "Kaduna Electricity",
    region: "Kaduna, Kebbi, Sokoto and Zamfara States",
  },
  PHED: {
    name: "Port Harcourt Electricity",
    region: "Rivers, Bayelsa, Cross River and Akwa-Ibom States",
  },
  EEDC: {
    name: "Enugu Electricity",
    region: "Abia, Anambra, Ebonyi, Enugu and Imo States",
  },
  JED: {
    name: "Jos Electricity",
    region: "Plateau, Bauchi, Benue and Gombe States",
  },
};

// Helper function to convert MeterTypeEnum to MeterType
function convertMeterType(meterType: MeterTypeEnum): MeterType {
  return meterType === MeterTypeEnum.PREPAID
    ? MeterType.PREPAID
    : MeterType.POSTPAID;
}

@Injectable()
export class ElectricityService {
  private readonly logger = new Logger(ElectricityService.name);

  constructor(
    @InjectModel(ElectricityPurchase.name)
    private electricityModel: Model<ElectricityPurchaseDocument>,
    @InjectConnection()
    private readonly connection: Connection,
    private walletService: WalletService,
    private readonly vtpassService: VtpassService,
  ) {}

  /**
   * Get list of electricity providers (static list — VTPass has no providers endpoint)
   */
  async getProviders(): Promise<any[]> {
    return Object.entries(PROVIDER_INFO).map(([code, info]) => ({
      code,
      name: info.name,
      logoUrl: null,
      region: info.region,
    }));
  }

  /**
   * Lookup meter details via VTPass
   */
  async lookupMeter(dto: LookupMeterDto): Promise<any> {
    try {
      this.logger.debug(
        `Looking up meter: ${dto.meterNumber}, provider: ${dto.provider}, type: ${dto.meterType}`,
      );

      const result = await this.vtpassService.verifyMeter({
        provider: dto.provider,
        meterNumber: dto.meterNumber,
        meterType: dto.meterType as 'prepaid' | 'postpaid',
      });

      const providerInfo = PROVIDER_INFO[dto.provider] || { name: dto.provider };

      return {
        reference: dto.meterNumber,
        customerName: result.customerName,
        minimumVend: result.minimumVend,
        accountType: dto.meterType,
        outstandingDebt: '0',
        address: result.address,
        meterType: dto.meterType,
        meterNumber: dto.meterNumber,
        provider: dto.provider,
        providerName: providerInfo.name,
      };
    } catch (error: any) {
      this.logger.error(`Meter lookup failed: ${error.message}`);
      throw new BadRequestException(
        error.message || "Meter lookup failed. Please check the details and try again.",
      );
    }
  }

  /**
   * Purchase electricity
   */
  async purchaseElectricity(
    userId: string,
    dto: PurchaseElectricityDto,
  ): Promise<ElectricityPurchaseDocument> {
    const reference = `ELEC_${randomBytes(4).toString('hex').toUpperCase()}_${Date.now().toString(36).toUpperCase()}`;

    this.logger.log(
      `Electricity purchase initiated: user=${userId}, meter=${dto.meterNumber}, amount=${dto.amount}, ref=${reference}`,
    );

    const providerInfo = PROVIDER_INFO[dto.provider] || { name: dto.provider };
    const schemaMeteryType = convertMeterType(dto.meterType);

    const purchase = await this.electricityModel.create({
      userId: new Types.ObjectId(userId),
      provider: dto.provider,
      providerName: providerInfo.name,
      meterNumber: dto.meterNumber,
      meterType: schemaMeteryType,
      customerName: dto.customerName,
      customerAddress: dto.customerAddress || "",
      phoneNumber: dto.phoneNumber,
      email: dto.email,
      amount: dto.amount,
      reference,
      providerReference: dto.providerReference,
      status: ElectricityPurchaseStatus.PENDING,
    });

    try {
      // Step 1: Debit wallet (convert Naira to kobo)
      const walletTxn = (await this.walletService.debitWallet({
        userId,
        amount: dto.amount * 100,
        category: TransactionCategory.ELECTRICITY,
        source: TransactionSource.VTU_VTPASS,
        reference,
        narration: `Electricity: ${dto.meterNumber} (${dto.provider})`,
        meta: {
          meterNumber: dto.meterNumber,
          provider: dto.provider,
          providerName: providerInfo.name,
          customerName: dto.customerName,
          meterType: dto.meterType,
        },
      })) as WalletTransactionDocument;

      purchase.walletTransactionId = walletTxn._id;
      await purchase.save();

      // Step 2: Call VTPass to vend electricity
      let phone = dto.phoneNumber.replace(/\s/g, "");
      if (phone.startsWith("+234")) {
        phone = "0" + phone.substring(4);
      } else if (phone.startsWith("234") && phone.length === 13) {
        phone = "0" + phone.substring(3);
      }

      const vtpassResult = await this.vtpassService.purchaseElectricity({
        provider: dto.provider,
        meterNumber: dto.meterNumber,
        meterType: dto.meterType as 'prepaid' | 'postpaid',
        amount: dto.amount,
        phone,
        reference,
      });

      if (!vtpassResult.success) {
        throw new Error("Electricity vending failed");
      }

      // Step 3: Extract extended fields from VTPass response
      const fullResponse = vtpassResult.raw;
      this.logger.debug(`VTPass electricity response: ${JSON.stringify(fullResponse).slice(0, 800)}`);

      const token = fullResponse?.purchased_code || fullResponse?.token || fullResponse?.mainToken || fullResponse?.resetToken || vtpassResult.token || '';
      const units = fullResponse?.units || vtpassResult.units || '';
      const tariff = fullResponse?.tariff || '';
      const tokenAmount = fullResponse?.tokenAmount || null;
      const resetToken = fullResponse?.resetToken || '';
      const configureToken = fullResponse?.configureToken || '';
      const exchangeReference = fullResponse?.exchangeReference || '';
      const responseCustomerName = fullResponse?.customerName || '';
      const responseCustomerAddress = fullResponse?.customerAddress || '';
      const utilityName = fullResponse?.utilityName || '';
      const balance = fullResponse?.balance || null;

      this.logger.log(
        `Electricity result — token: "${token}", units: "${units}", tariff: "${tariff}", ` +
        `exchangeRef: "${exchangeReference}", utilityName: "${utilityName}", balance: ${balance}`,
      );

      // Step 4: Update purchase record with success and extended fields
      purchase.status = ElectricityPurchaseStatus.SUCCESS;
      purchase.token = token;
      purchase.units = units;
      purchase.exchangeReference = exchangeReference;
      purchase.tariff = tariff;
      purchase.tokenAmount = tokenAmount;
      if (responseCustomerName) purchase.customerName = responseCustomerName;
      if (responseCustomerAddress) purchase.customerAddress = responseCustomerAddress;
      purchase.utilityName = utilityName;
      purchase.balance = balance;
      purchase.resetToken = resetToken;
      purchase.configureToken = configureToken;
      purchase.providerResponse = fullResponse;
      await purchase.save();

      await this.walletService.updateTransactionStatus(
        walletTxn._id.toString(),
        "SUCCESS",
      );

      this.logger.log(
        `Electricity purchase successful: ref=${reference}, token=${purchase.token}`,
      );

      return purchase;
    } catch (error: any) {
      this.logger.error(`Electricity purchase failed: ${error.message}`);

      purchase.status = ElectricityPurchaseStatus.FAILED;
      purchase.failureReason = error.message;
      await purchase.save();

      if (purchase.walletTransactionId) {
        try {
          await this.walletService.creditWallet({
            userId,
            amount: dto.amount * 100,
            category: TransactionCategory.ELECTRICITY,
            source: TransactionSource.VTU_VTPASS,
            reference: `${reference}_REFUND`,
            narration: `Refund: Electricity ${dto.meterNumber} failed`,
            meta: {
              originalReference: reference,
              reason: "Purchase failed",
            },
          });

          purchase.status = ElectricityPurchaseStatus.REFUNDED;
          purchase.refundedAt = new Date();
          purchase.refundReason = error.message;
          await purchase.save();

          this.logger.log(
            `Auto-refunded electricity purchase: ref=${reference}`,
          );
        } catch (refundError: any) {
          this.logger.error(
            `Failed to refund electricity purchase: ref=${reference}, error=${refundError.message}`,
          );
        }
      }

      throw new BadRequestException(
        error.message || "Electricity purchase failed",
      );
    }
  }

  /**
   * Get user's electricity purchases
   */
  async getUserPurchases(
    userId: string,
    query: GetElectricityPurchasesDto,
  ): Promise<{
    data: ElectricityPurchaseDocument[];
    total: number;
    page: number;
    pages: number;
  }> {
    const { page = 1, limit = 20, status, provider, meterNumber } = query;
    const skip = (page - 1) * limit;

    const filter: any = { userId: new Types.ObjectId(userId) };
    if (status) filter.status = status;
    if (provider) filter.provider = provider;
    if (meterNumber) filter.meterNumber = meterNumber;

    const [data, total] = await Promise.all([
      this.electricityModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.electricityModel.countDocuments(filter),
    ]);

    return {
      data,
      total,
      page,
      pages: Math.ceil(total / limit),
    };
  }

  /**
   * Get purchase by reference
   */
  async getPurchaseByReference(
    userId: string,
    reference: string,
  ): Promise<ElectricityPurchaseDocument> {
    const purchase = await this.electricityModel.findOne({
      userId: new Types.ObjectId(userId),
      reference,
    });

    if (!purchase) {
      throw new NotFoundException("Electricity purchase not found");
    }

    return purchase;
  }

  /**
   * Admin: Get all purchases with filters
   */
  async getAllPurchases(
    query: GetElectricityPurchasesDto & { userId?: string },
  ): Promise<{
    data: ElectricityPurchaseDocument[];
    total: number;
    page: number;
    pages: number;
  }> {
    const {
      page = 1,
      limit = 20,
      status,
      provider,
      meterNumber,
      userId,
      startDate,
      endDate,
    } = query;
    const skip = (page - 1) * limit;

    const filter: any = {};
    if (userId) filter.userId = new Types.ObjectId(userId);
    if (status) filter.status = status;
    if (provider) filter.provider = provider;
    if (meterNumber) filter.meterNumber = meterNumber;
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    }

    const [data, total] = await Promise.all([
      this.electricityModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("userId", "email fullName phone")
        .exec(),
      this.electricityModel.countDocuments(filter),
    ]);

    return {
      data,
      total,
      page,
      pages: Math.ceil(total / limit),
    };
  }

  /**
   * Admin: Manual refund
   */
  async manualRefund(
    purchaseId: string,
    adminId: string,
    reason: string,
  ): Promise<ElectricityPurchaseDocument> {
    const session = await this.connection.startSession();
    session.startTransaction();

    try {
      const purchase = await this.electricityModel
        .findById(purchaseId)
        .session(session);

      if (!purchase) {
        throw new NotFoundException("Electricity purchase not found");
      }

      if (purchase.status === ElectricityPurchaseStatus.REFUNDED) {
        throw new BadRequestException("Purchase already refunded");
      }

      if (purchase.status === ElectricityPurchaseStatus.SUCCESS) {
        throw new BadRequestException("Cannot refund successful purchase");
      }

      await this.walletService.creditWallet({
        userId: purchase.userId.toString(),
        amount: purchase.amount * 100,
        category: TransactionCategory.ELECTRICITY,
        source: TransactionSource.MANUAL_ADJUSTMENT,
        reference: `${purchase.reference}_MANUAL_REFUND`,
        narration: `Manual Refund: Electricity ${purchase.meterNumber}`,
        meta: {
          originalReference: purchase.reference,
          reason,
          adminId,
        },
        session,
      });

      purchase.status = ElectricityPurchaseStatus.REFUNDED;
      purchase.refundedAt = new Date();
      purchase.refundReason = reason;
      await purchase.save({ session });

      await session.commitTransaction();

      this.logger.log(
        `Manual refund processed: ref=${purchase.reference}, admin=${adminId}`,
      );

      return purchase;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  async getAdminStats(): Promise<any> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const revenuePipeline = (extraMatch: Record<string, any> = {}) => [
      {
        $match: {
          status: ElectricityPurchaseStatus.SUCCESS,
          ...extraMatch,
        },
      },
      {
        $addFields: {
          computedProviderCost: {
            $cond: {
              if: {
                $and: [
                  { $gt: ["$providerCost", null] },
                  { $gt: ["$providerCost", 0] },
                ],
              },
              then: "$providerCost",
              else: {
                $cond: {
                  if: { $gt: ["$providerResponse.merchant_amount", null] },
                  then: { $toDouble: "$providerResponse.merchant_amount" },
                  else: "$amount",
                },
              },
            },
          },
        },
      },
      {
        $addFields: {
          computedProfit: { $subtract: ["$amount", "$computedProviderCost"] },
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

    const providerPipeline = [
      { $match: { status: ElectricityPurchaseStatus.SUCCESS } },
      {
        $addFields: {
          computedProviderCost: {
            $cond: {
              if: {
                $and: [
                  { $gt: ["$providerCost", null] },
                  { $gt: ["$providerCost", 0] },
                ],
              },
              then: "$providerCost",
              else: {
                $cond: {
                  if: { $gt: ["$providerResponse.merchant_amount", null] },
                  then: { $toDouble: "$providerResponse.merchant_amount" },
                  else: "$amount",
                },
              },
            },
          },
        },
      },
      {
        $addFields: {
          computedProfit: { $subtract: ["$amount", "$computedProviderCost"] },
        },
      },
      {
        $group: {
          _id: "$provider",
          providerName: { $first: "$providerName" },
          totalAmount: { $sum: "$amount" },
          totalProviderCost: { $sum: "$computedProviderCost" },
          totalProfit: { $sum: "$computedProfit" },
          count: { $sum: 1 },
        },
      },
      { $sort: { totalAmount: -1 as 1 | -1 } },
    ];

    const [
      allRevenue,
      todayRevenue,
      byProvider,
      total,
      successCount,
      pendingCount,
      failedCount,
      refundedCount,
      prepaidCount,
      postpaidCount,
      todayCount,
    ] = await Promise.all([
      this.electricityModel.aggregate(revenuePipeline()),
      this.electricityModel.aggregate(
        revenuePipeline({ createdAt: { $gte: today } }),
      ),
      this.electricityModel.aggregate(providerPipeline),
      this.electricityModel.countDocuments(),
      this.electricityModel.countDocuments({
        status: ElectricityPurchaseStatus.SUCCESS,
      }),
      this.electricityModel.countDocuments({
        status: ElectricityPurchaseStatus.PENDING,
      }),
      this.electricityModel.countDocuments({
        status: ElectricityPurchaseStatus.FAILED,
      }),
      this.electricityModel.countDocuments({
        status: ElectricityPurchaseStatus.REFUNDED,
      }),
      this.electricityModel.countDocuments({ meterType: "prepaid" }),
      this.electricityModel.countDocuments({ meterType: "postpaid" }),
      this.electricityModel.countDocuments({ createdAt: { $gte: today } }),
    ]);

    const all = allRevenue[0] || {
      totalAmount: 0,
      totalProviderCost: 0,
      totalProfit: 0,
      count: 0,
    };
    const day = todayRevenue[0] || {
      totalAmount: 0,
      totalProviderCost: 0,
      totalProfit: 0,
      count: 0,
    };

    return {
      totalTransactions: total,
      totalTransactionsToday: todayCount,
      totalAmount: all.totalAmount,
      totalProviderCost: all.totalProviderCost,
      totalProfit: all.totalProfit,
      todayAmount: day.totalAmount,
      todayProviderCost: day.totalProviderCost,
      todayProfit: day.totalProfit,
      todayTransactions: day.count,

      statusCounts: {
        success: successCount,
        pending: pendingCount,
        failed: failedCount,
        refunded: refundedCount,
      },

      meterTypeCounts: {
        prepaid: prepaidCount,
        postpaid: postpaidCount,
      },

      byProvider: byProvider.map((p: any) => ({
        provider: p._id,
        providerName: p.providerName || p._id,
        totalAmount: p.totalAmount,
        totalProviderCost: p.totalProviderCost,
        totalProfit: p.totalProfit,
        count: p.count,
      })),
    };
  }
}
