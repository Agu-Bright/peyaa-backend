/**
 * TV Subscription Controllers
 *
 * User endpoints: providers, bouquets, verify smartcard, purchase, history
 * Admin endpoints: all purchases, refund
 */
import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiSecurity,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PinGuard } from '../common/guards/pin.guard';
import { CurrentUser, Roles, RequirePin } from '../common/decorators';
import { RolesGuard } from '../common/guards/roles.guard';
import { TvService } from './tv-subscription.service';
import {
  VerifySmartcardDto,
  PurchaseTvDto,
  GetBouquetsDto,
  GetTvPurchasesDto,
} from './dto/tv-subscription.dto';

// ─── User Controller ─────────────────────────────────────

@ApiTags('TV Subscription')
@Controller('tv')
export class TvController {
  constructor(private readonly tvService: TvService) {}

  @Get('providers')
  @ApiOperation({ summary: 'Get TV providers (DStv, GOtv, StarTimes)' })
  @ApiResponse({ status: 200, description: 'List of TV providers' })
  getProviders() {
    return this.tvService.getProviders();
  }

  @Get('bouquets')
  @ApiOperation({ summary: 'Get available bouquets/plans for a provider' })
  @ApiResponse({ status: 200, description: 'List of bouquets' })
  getBouquets(@Query() query: GetBouquetsDto) {
    return this.tvService.getBouquets(query.provider);
  }

  @Post('verify')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify smartcard/decoder number' })
  @ApiResponse({ status: 200, description: 'Smartcard verified' })
  @ApiResponse({ status: 400, description: 'Invalid smartcard' })
  verifySmartcard(
    @Body() dto: VerifySmartcardDto,
  ) {
    return this.tvService.verifySmartcard(dto);
  }

  @Post('purchase')
  @UseGuards(JwtAuthGuard, PinGuard)
  @RequirePin()
  @ApiBearerAuth('JWT-auth')
  @ApiSecurity('pin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Purchase TV subscription' })
  @ApiResponse({ status: 200, description: 'Subscription purchased' })
  @ApiResponse({ status: 400, description: 'Purchase failed' })
  purchaseTv(
    @CurrentUser('sub') userId: string,
    @Body() dto: PurchaseTvDto,
  ) {
    return this.tvService.purchaseTv(userId, dto);
  }

  @Get('purchases')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get user TV purchase history' })
  @ApiResponse({ status: 200, description: 'Purchase history' })
  getUserPurchases(
    @CurrentUser('sub') userId: string,
    @Query() query: GetTvPurchasesDto,
  ) {
    return this.tvService.getUserPurchases(userId, query);
  }

  @Get('purchases/:reference')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get specific TV purchase by reference' })
  @ApiResponse({ status: 200, description: 'Purchase details' })
  @ApiResponse({ status: 404, description: 'Not found' })
  getPurchaseByReference(
    @CurrentUser('sub') userId: string,
    @Param('reference') reference: string,
  ) {
    return this.tvService.getPurchaseByReference(userId, reference);
  }
}

// ─── Admin Controller ────────────────────────────────────

@ApiTags('Admin - TV')
@Controller('admin/tv')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@ApiBearerAuth('JWT-auth')
export class AdminTvController {
  constructor(private readonly tvService: TvService) {}

  @Get('purchases')
  @ApiOperation({ summary: 'Get all TV purchases (admin)' })
  @ApiResponse({ status: 200, description: 'All TV purchases' })
  getAllPurchases(@Query() query: GetTvPurchasesDto & { userId?: string }) {
    return this.tvService.getAllPurchases(query);
  }

  @Post('purchases/:id/refund')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Manual refund TV purchase (admin)' })
  @ApiResponse({ status: 200, description: 'Refunded' })
  @ApiResponse({ status: 404, description: 'Not found' })
  manualRefund(
    @Param('id') id: string,
    @CurrentUser('sub') adminId: string,
    @Body('reason') reason: string,
  ) {
    return this.tvService.manualRefund(id, adminId, reason || 'Admin manual refund');
  }
}
