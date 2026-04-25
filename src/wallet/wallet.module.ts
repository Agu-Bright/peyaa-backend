/**
 * Wallet Module
 * 
 * Manages user wallets and transactions.
 */
import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';
import { Wallet, WalletSchema } from './schemas/wallet.schema';
import {
  WalletTransaction,
  WalletTransactionSchema,
} from './schemas/wallet-transaction.schema';
import { PaystackModule } from '../paystack/paystack.module';
import { UsersModule } from '../users/users.module';
import { BankAccount, BankAccountSchema } from './schemas/bank-account.schema';
import { WithdrawalService } from './withdrawal.service';
import { WithdrawalController } from './withdrawal.controller';
import { Withdrawal, WithdrawalSchema } from './schemas/withdrawal.schema';
import { ReferralModule } from '../referral/referral.module';


@Module({
  imports: [
   MongooseModule.forFeature([
      { name: Wallet.name, schema: WalletSchema },
      { name: WalletTransaction.name, schema: WalletTransactionSchema },
      { name: BankAccount.name, schema: BankAccountSchema },
      { name: Withdrawal.name, schema: WithdrawalSchema },
    ]),
    forwardRef(() => PaystackModule),
    forwardRef(() => ReferralModule),
    UsersModule, // Import UsersModule so PinGuard can access UsersService
  ],
  controllers: [WalletController, WithdrawalController],
  providers: [WalletService, WithdrawalService],
  exports: [WalletService, WithdrawalService],
})
export class WalletModule {}