/**
 * Admin Notifications Controller
 *
 * Handles broadcasting push/email notifications to user groups
 * and listing the broadcast history for the admin dashboard.
 */
import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser, Roles } from '../common/decorators';
import { NotificationsService } from './notifications.service';
import { SendBroadcastDto, NotificationHistoryQueryDto } from './dto';

@ApiTags('Admin - Notifications')
@ApiBearerAuth('JWT-auth')
@Controller('admin/notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminNotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('send')
  @ApiOperation({ summary: 'Send a broadcast (push or email)' })
  @ApiResponse({ status: 201, description: 'Broadcast queued / sent' })
  async sendBroadcast(
    @CurrentUser('sub') adminUserId: string,
    @Body() dto: SendBroadcastDto,
  ) {
    return this.notificationsService.sendBroadcast(dto, adminUserId);
  }

  @Get('history')
  @ApiOperation({ summary: 'List past broadcasts (paginated)' })
  @ApiResponse({ status: 200, description: 'Paginated broadcast history' })
  async getHistory(@Query() query: NotificationHistoryQueryDto) {
    return this.notificationsService.getNotificationHistory(query);
  }
}
