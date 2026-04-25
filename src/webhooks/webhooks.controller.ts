/**
 * Webhooks Controller
 * 
 * Handles incoming webhooks from payment providers:
 * - Paystack payment notifications
 */
import {
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  RawBodyRequest,
  Req,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiExcludeEndpoint } from '@nestjs/swagger';
import { Request } from 'express';
import { PaystackService } from '../paystack/paystack.service';
import { WalletService } from '../wallet/wallet.service';
import { TransactionCategory, TransactionSource } from '../wallet/schemas/wallet-transaction.schema';
import { Public } from '../common/decorators';

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly paystackService: PaystackService,
    private readonly walletService: WalletService,
  ) {}

  /**
   * Paystack Webhook Handler
   * 
   * Processes payment notifications from Paystack:
   * 1. Verifies webhook signature
   * 2. Updates transaction status
   * 3. Credits wallet on successful payment
   */
  @Post('paystack')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Paystack webhook endpoint' })
  @ApiResponse({ status: 200, description: 'Webhook processed' })
  @ApiResponse({ status: 400, description: 'Invalid signature' })
  async handlePaystackWebhook(
    @Body() body: any,
    @Headers('x-paystack-signature') signature: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    this.logger.log('Received Paystack webhook');

    // Get raw body for signature verification
    const rawBody = req.rawBody?.toString() || JSON.stringify(body);

    // Verify signature
    if (!signature || !this.paystackService.verifyWebhookSignature(rawBody, signature)) {
      this.logger.warn('Invalid Paystack webhook signature');
      throw new BadRequestException('Invalid signature');
    }

    const event = body.event;
    const data = body.data;

    this.logger.log(`Paystack event: ${event}, reference: ${data?.reference}`);

    // Handle charge.success event
    if (event === 'charge.success') {
      await this.handlePaystackChargeSuccess(data, body);
    }

    // Always return 200 to acknowledge receipt
    return { received: true };
  }

  /**
   * Handle successful Paystack charge
   */
  private async handlePaystackChargeSuccess(
    data: any,
    fullEvent: any,
  ): Promise<void> {
    const reference = data.reference;
    const amount = data.amount; // In kobo
    const metadata = data.metadata || {};
    const userId = metadata.userId;

    if (!reference) {
      this.logger.warn('Paystack webhook missing reference');
      return;
    }

    // Check if already processed (idempotency)
    const isProcessed = await this.paystackService.isTransactionProcessed(reference);
    if (isProcessed) {
      this.logger.log(`Paystack payment already processed: ${reference}`);
      return;
    }

    // Update Paystack transaction record
    await this.paystackService.updateTransactionFromWebhook(reference, fullEvent);

    // Credit wallet if this is a top-up
    if (metadata.type === 'WALLET_TOPUP' && userId) {
      try {
        // Check if wallet transaction already exists (double idempotency)
        const existingTxn = await this.walletService.findTransactionByReference(reference);
        if (existingTxn) {
          this.logger.log(`Wallet already credited for: ${reference}`);
          return;
        }

        // Credit wallet
        await this.walletService.creditWallet({
          userId,
          amount,
          category: TransactionCategory.TOPUP,
          source: TransactionSource.PAYSTACK_TOPUP,
          narration: `Wallet top-up via Paystack`,
          reference,
          meta: {
            paystackReference: reference,
            channel: data.channel,
            gatewayResponse: data.gateway_response,
          },
        });

        this.logger.log(`Wallet credited: ${userId}, amount: ${amount}, ref: ${reference}`);
      } catch (error) {
        // Handle duplicate key error gracefully (already processed)
        if (error.code === 11000) {
          this.logger.log(`Duplicate transaction reference: ${reference}`);
          return;
        }
        this.logger.error(`Failed to credit wallet: ${error.message}`, error);
        throw error;
      }
    }
  }
}
