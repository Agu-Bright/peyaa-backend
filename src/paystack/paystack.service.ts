/**
 * Paystack Service
 * 
 * Handles integration with Paystack payment gateway:
 * - Initialize transactions
 * - Verify transactions
 * - Webhook signature verification
 */
import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import * as crypto from 'crypto';
import {
  PaystackTransaction,
  PaystackTransactionDocument,
  PaystackTransactionStatus,
} from './schemas/paystack-transaction.schema';

export interface InitializeTransactionParams {
  email: string;
  amount: number; // In kobo
  reference: string;
  callbackUrl?: string;
  metadata?: Record<string, any>;
}

export interface InitializeTransactionResult {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
}

export interface VerifyTransactionResult {
  success: boolean;
  amount: number; // In kobo
  reference: string;
  status: string;
  channel?: string;
  paidAt?: Date;
  gatewayResponse?: string;
}

@Injectable()
export class PaystackService {
  private readonly logger = new Logger(PaystackService.name);
  private readonly apiClient: AxiosInstance;
  private readonly secretKey: string;
  private readonly webhookSecret: string;

  constructor(
    @InjectModel(PaystackTransaction.name)
    private readonly paystackTxnModel: Model<PaystackTransactionDocument>,
    private readonly configService: ConfigService,
  ) {
    this.secretKey = this.configService.get<string>('PAYSTACK_SECRET_KEY') || '';
    this.webhookSecret = this.configService.get<string>('PAYSTACK_WEBHOOK_SECRET') || '';
    
    const baseUrl = this.configService.get<string>('PAYSTACK_BASE_URL') || 'https://api.paystack.co';

    this.apiClient = axios.create({
      baseURL: baseUrl,
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    // Request/response logging (sanitized)
    this.apiClient.interceptors.request.use((config) => {
      this.logger.debug(`Paystack Request: ${config.method?.toUpperCase()} ${config.url}`);
      return config;
    });

    this.apiClient.interceptors.response.use(
      (response) => {
        this.logger.debug(`Paystack Response: ${response.status}`);
        return response;
      },
      (error) => {
        this.logger.error(`Paystack Error: ${error.message}`, error.response?.data);
        return Promise.reject(error);
      },
    );
  }

  /**
   * Initialize a Paystack transaction
   */
  async initializeTransaction(
    params: InitializeTransactionParams,
  ): Promise<InitializeTransactionResult> {
    try {
      const response = await this.apiClient.post('/transaction/initialize', {
        email: params.email,
        amount: params.amount,
        reference: params.reference,
        callback_url: params.callbackUrl,
        metadata: params.metadata,
      });

      const data = response.data.data;

      this.logger.log(`Paystack transaction initialized: ${params.reference}`);

      return {
        authorizationUrl: data.authorization_url,
        accessCode: data.access_code,
        reference: data.reference,
      };
    } catch (error) {
      this.logger.error('Failed to initialize Paystack transaction', error);
      throw new InternalServerErrorException('Failed to initialize payment');
    }
  }

  /**
   * Verify a Paystack transaction
   */
  async verifyTransaction(reference: string): Promise<VerifyTransactionResult> {
    try {
      const response = await this.apiClient.get(
        `/transaction/verify/${encodeURIComponent(reference)}`,
      );

      const data = response.data.data;
      const success = data.status === 'success';

      this.logger.log(
        `Paystack transaction verified: ${reference}, status: ${data.status}`,
      );

      return {
        success,
        amount: data.amount,
        reference: data.reference,
        status: data.status,
        channel: data.channel,
        paidAt: data.paid_at ? new Date(data.paid_at) : undefined,
        gatewayResponse: data.gateway_response,
      };
    } catch (error) {
      this.logger.error('Failed to verify Paystack transaction', error);
      return {
        success: false,
        amount: 0,
        reference,
        status: 'failed',
      };
    }
  }

  /**
   * Verify Paystack webhook signature
   */
  verifyWebhookSignature(payload: string, signature: string): boolean {
    if (!this.webhookSecret) {
      this.logger.warn('Paystack webhook secret not configured');
      return false;
    }

    const hash = crypto
      .createHmac('sha512', this.webhookSecret)
      .update(payload)
      .digest('hex');

    return hash === signature;
  }

  /**
   * Create a transaction record
   */
  async createTransactionRecord(params: {
    userId: string | Types.ObjectId;
    reference: string;
    amount: number;
    authorizationUrl?: string;
    accessCode?: string;
    metadata?: Record<string, any>;
  }): Promise<PaystackTransactionDocument> {
    const txn = new this.paystackTxnModel({
      userId: new Types.ObjectId(params.userId),
      reference: params.reference,
      amount: params.amount,
      status: PaystackTransactionStatus.PENDING,
      authorizationUrl: params.authorizationUrl,
      accessCode: params.accessCode,
      metadata: params.metadata,
    });

    return txn.save();
  }

  /**
   * Update transaction from webhook
   */
  async updateTransactionFromWebhook(
    reference: string,
    webhookData: Record<string, any>,
  ): Promise<PaystackTransactionDocument | null> {
    const data = webhookData.data || {};
    const status =
      data.status === 'success'
        ? PaystackTransactionStatus.SUCCESS
        : data.status === 'abandoned'
        ? PaystackTransactionStatus.ABANDONED
        : PaystackTransactionStatus.FAILED;

    const updated = await this.paystackTxnModel.findOneAndUpdate(
      { reference },
      {
        status,
        channel: data.channel,
        gatewayResponse: data.gateway_response,
        paidAt: data.paid_at ? new Date(data.paid_at) : undefined,
        rawWebhookEvent: webhookData,
      },
      { new: true },
    );

    if (updated) {
      this.logger.log(`Paystack transaction updated: ${reference} -> ${status}`);
    }

    return updated;
  }

  /**
   * Get transaction by reference
   */
  async getTransactionByReference(
    reference: string,
  ): Promise<PaystackTransactionDocument | null> {
    return this.paystackTxnModel.findOne({ reference }).exec();
  }

  /**
   * Check if transaction is already processed
   */
  async isTransactionProcessed(reference: string): Promise<boolean> {
    const txn = await this.getTransactionByReference(reference);
    return txn?.status === PaystackTransactionStatus.SUCCESS;
  }
}
