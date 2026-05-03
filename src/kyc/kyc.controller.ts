/**
 * KYC controllers — user-facing + admin.
 *
 * User endpoints:
 *   POST /kyc/submit           - submit KYC details for review
 *   GET  /kyc/status           - current tier + limit + latest submission
 *
 * Admin endpoints:
 *   GET  /admin/kyc            - paginated queue (filter by status)
 *   GET  /admin/kyc/:id        - single submission detail
 *   POST /admin/kyc/:id/approve
 *   POST /admin/kyc/:id/reject
 */
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser, Roles } from '../common/decorators';
import { KycService } from './kyc.service';
import {
  AdminKycQueryDto,
  ApproveKycDto,
  RejectKycDto,
  SubmitKycDto,
} from './dto/kyc.dto';

// ─── User-facing controller ───────────────────────────

@ApiTags('KYC')
@ApiBearerAuth('JWT-auth')
@Controller('kyc')
@UseGuards(JwtAuthGuard)
export class KycController {
  constructor(private readonly kycService: KycService) {}

  @Post('submit')
  @ApiOperation({ summary: 'Submit KYC details for admin review (Tier 2 upgrade)' })
  async submit(
    @CurrentUser('sub') userId: string,
    @Body() dto: SubmitKycDto,
  ) {
    const submission = await this.kycService.submitForReview(userId, dto);
    return { success: true, data: submission };
  }

  @Get('status')
  @ApiOperation({ summary: 'Get current KYC tier, wallet limit, and latest submission state' })
  async status(@CurrentUser('sub') userId: string) {
    const status = await this.kycService.getStatusForUser(userId);
    return { success: true, data: status };
  }
}

// ─── Admin controller ─────────────────────────────────

@ApiTags('Admin - KYC')
@ApiBearerAuth('JWT-auth')
@Controller('admin/kyc')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminKycController {
  constructor(private readonly kycService: KycService) {}

  @Get()
  @ApiOperation({ summary: 'List KYC submissions (paginated, filterable by status)' })
  async list(@Query() query: AdminKycQueryDto) {
    return this.kycService.listForAdmin(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single KYC submission with user info' })
  async getOne(@Param('id') id: string) {
    const submission = await this.kycService.getOneForAdmin(id);
    return { success: true, data: submission };
  }

  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve a KYC submission and bump user to Tier 2' })
  async approve(
    @Param('id') id: string,
    @CurrentUser('sub') adminId: string,
    @Body() dto: ApproveKycDto,
  ) {
    const submission = await this.kycService.approve(id, adminId, dto);
    return { success: true, data: submission };
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject a KYC submission with a reason' })
  async reject(
    @Param('id') id: string,
    @CurrentUser('sub') adminId: string,
    @Body() dto: RejectKycDto,
  ) {
    const submission = await this.kycService.reject(id, adminId, dto);
    return { success: true, data: submission };
  }
}
