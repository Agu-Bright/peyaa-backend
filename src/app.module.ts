// src/app.module.ts
/**
 * App Module - Root module that imports all feature modules
 */
import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerMiddleware } from './common/middleware/logger.middleware';

// Feature Modules
import { CommonModule } from './common/common.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { WalletModule } from './wallet/wallet.module';
import { GiftCardsModule } from './giftcards/giftcards.module';
import { VtuModule } from './vtu/vtu.module';
import { UploadsModule } from './uploads/uploads.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { AdminModule } from './admin/admin.module';
import { EmailModule } from './email/email.module';
import { OtpModule } from './otp/otp.module';
import { PaystackModule } from './paystack/paystack.module';
import { AuditModule } from './audit/audit.module';
import { SettingsModule } from './settings/settings.module';
import { SupportModule } from './support/support.module';
import { ReferralModule } from './referral/referral.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PromosModule } from './promos/promos.module';
import { KycModule } from './kyc/kyc.module';

// App Controller
import { AppController } from './app.controller';

@Module({
  imports: [
    // Configuration module - loads .env variables
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validate: (config: Record<string, unknown>) => {
        const required = [
          'MONGO_URI',
          'JWT_ACCESS_SECRET',
          'JWT_REFRESH_SECRET',
          'PAYSTACK_SECRET_KEY',
        ];
        const missing = required.filter((key) => !config[key]);
        if (missing.length > 0) {
          throw new Error(
            `FATAL: Missing required environment variables: ${missing.join(', ')}`,
          );
        }
        return config;
      },
    }),

    // Task scheduling (cron jobs)
    ScheduleModule.forRoot(),

    // Rate limiting — default: 60 requests per minute per IP
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60000,
        limit: 60,
      },
    ]),

    // MongoDB connection
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('MONGO_URI'),
        // MongoDB connection options
        retryAttempts: 5,
        retryDelay: 1000,
      }),
      inject: [ConfigService],
    }),

    // Common utilities (guards, interceptors, etc.)
    CommonModule,

    // Core feature modules
    AuthModule,
    UsersModule,
    WalletModule,
    GiftCardsModule,
    VtuModule,
    UploadsModule,
    WebhooksModule,
    AdminModule,
    
    SettingsModule,
    SupportModule,
    ReferralModule,
    NotificationsModule,
    PromosModule,
    KycModule,

    // Supporting modules
    EmailModule,
    OtpModule,
    PaystackModule,
    AuditModule,
  ],
  controllers: [AppController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('*');
  }
}