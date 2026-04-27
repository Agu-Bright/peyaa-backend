/**
 * VTU Module
 *
 * Handles airtime, data, electricity, and TV subscription purchases via VTPass.
 */
import { Module, forwardRef } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { HttpModule } from "@nestjs/axios";
import { VtuController } from "./vtu.controller";
import { SquadCoService } from "./squadco.service";
import { VtpassService } from "./vtpass.service";
import {
  AirtimePurchase,
  AirtimePurchaseSchema,
  DataPurchase,
  DataPurchaseSchema,
} from "./schemas/vtu-purchase.schema";
import { WalletModule } from "../wallet/wallet.module";
import { UsersModule } from "../users/users.module";
import {
  ElectricityPurchase,
  ElectricityPurchaseSchema,
} from "./schemas/electricity-purchase.schema";
import {
  TvPurchase,
  TvPurchaseSchema,
} from "./schemas/tv-subscription.schema";
import { User, UserSchema } from "../users/schemas/user.schema";

import { ElectricityController, AdminElectricityController } from './electricity.controller';
import { ElectricityService } from './electricity.service';
import { TvController, AdminTvController } from './tv-subscription.controller';
import { TvService } from './tv-subscription.service';
import { TvReminderService } from './tv-reminder.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AirtimePurchase.name, schema: AirtimePurchaseSchema },
      { name: DataPurchase.name, schema: DataPurchaseSchema },
      { name: ElectricityPurchase.name, schema: ElectricityPurchaseSchema },
      { name: TvPurchase.name, schema: TvPurchaseSchema },
      // User model needed by TvReminderService to look up email/fullName
      { name: User.name, schema: UserSchema },
    ]),
    HttpModule,
    forwardRef(() => WalletModule),
    UsersModule,
  ],
  controllers: [
    VtuController,
    ElectricityController,
    AdminElectricityController,
    TvController,
    AdminTvController,
  ],
  providers: [
    VtpassService,
    SquadCoService,
    ElectricityService,
    TvService,
    TvReminderService,
  ],
  exports: [VtpassService, SquadCoService, ElectricityService, TvService],
})
export class VtuModule {}
