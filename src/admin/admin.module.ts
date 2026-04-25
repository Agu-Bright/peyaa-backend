/**
 * Admin Module
 * Handles all admin-only operations and management features
 */
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

// Existing
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';

// RBAC schemas
import { AdminRole, AdminRoleSchema } from './schemas/admin-role.schema';
import { AdminUser, AdminUserSchema } from './schemas/admin-user.schema';

// External schemas
import { User, UserSchema } from '../users/schemas/user.schema';
import { Wallet, WalletSchema } from '../wallet/schemas/wallet.schema';
import {
  WalletTransaction,
  WalletTransactionSchema,
} from '../wallet/schemas/wallet-transaction.schema';
import {
  GiftCardTrade,
  GiftCardTradeSchema,
} from '../giftcards/schemas/gift-card-trade.schema';
import {
  AirtimePurchase,
  AirtimePurchaseSchema,
  DataPurchase,
  DataPurchaseSchema,
} from '../vtu/schemas/vtu-purchase.schema';
import {
  PaystackTransaction,
  PaystackTransactionSchema,
} from '../paystack/schemas/paystack-transaction.schema';
import {
  ElectricityPurchase,
  ElectricityPurchaseSchema,
} from '../vtu/schemas/electricity-purchase.schema';
import { Withdrawal, WithdrawalSchema } from '../wallet/schemas/withdrawal.schema';

// RBAC controllers & services
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import { AdminRolesController } from './admin-roles.controller';
import { AdminRolesService } from './admin-roles.service';
import { AdminSeedService } from './seeds/seed-roles';

// Feature modules
import { WalletModule } from '../wallet/wallet.module';
import { GiftCardsModule } from '../giftcards/giftcards.module';
import { UsersModule } from '../users/users.module';
import { SettingsModule } from '../settings/settings.module';
import { SupportModule } from '../support/support.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Wallet.name, schema: WalletSchema },
      { name: WalletTransaction.name, schema: WalletTransactionSchema },
      { name: GiftCardTrade.name, schema: GiftCardTradeSchema },
      { name: AirtimePurchase.name, schema: AirtimePurchaseSchema },
      { name: DataPurchase.name, schema: DataPurchaseSchema },
      { name: PaystackTransaction.name, schema: PaystackTransactionSchema },
      { name: ElectricityPurchase.name, schema: ElectricityPurchaseSchema },
      { name: Withdrawal.name, schema: WithdrawalSchema },
      { name: AdminRole.name, schema: AdminRoleSchema },
      { name: AdminUser.name, schema: AdminUserSchema },
    ]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_ACCESS_SECRET'),
        signOptions: { expiresIn: '30m' },
      }),
      inject: [ConfigService],
    }),
    WalletModule,
    GiftCardsModule,
    UsersModule,
    SettingsModule,
    SupportModule,
  ],
  controllers: [
    // More-specific prefix controllers MUST come before AdminController
    // to prevent GET /admin/users/:id from intercepting /admin/users/admins etc.
    AdminAuthController,
    AdminUsersController,
    AdminRolesController,
    AdminController,
  ],
  providers: [
    AdminService,
    AdminAuthService,
    AdminUsersService,
    AdminRolesService,
    AdminSeedService,
  ],
  exports: [AdminService, AdminAuthService],
})
export class AdminModule {}
