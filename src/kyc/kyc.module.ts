/**
 * KYC module — registers schema, service, and both user/admin controllers.
 *
 * Depends on NotificationsService (already global) and EmailService (also global).
 * Re-uses User schema for the wallet-limit / kycTier writes.
 */
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import {
  KycSubmission,
  KycSubmissionSchema,
} from './schemas/kyc-submission.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { KycController, AdminKycController } from './kyc.controller';
import { KycService } from './kyc.service';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: KycSubmission.name, schema: KycSubmissionSchema },
      { name: User.name, schema: UserSchema },
    ]),
    EmailModule,
  ],
  controllers: [KycController, AdminKycController],
  providers: [KycService],
  exports: [KycService],
})
export class KycModule {}
