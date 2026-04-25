/**
 * Support Controller
 * Handles authenticated user endpoints for support tickets
 */
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { SupportService } from './support.service';
import {
  CreateTicketDto,
  ReplyTicketDto,
  TicketQueryDto,
} from './dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators';
import { JwtPayload } from '../auth/strategies/jwt.strategy';

@ApiTags('Support')
@Controller('support/tickets')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new support ticket' })
  @ApiResponse({
    status: 201,
    description: 'Ticket created successfully',
  })
  @ApiResponse({ status: 400, description: 'Invalid request data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async createTicket(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateTicketDto,
  ) {
    return this.supportService.createTicket(user.sub, dto);
  }

  @Get('my')
  @ApiOperation({ summary: "Get current user's support tickets" })
  @ApiResponse({
    status: 200,
    description: "Paginated list of user's tickets",
  })
  async getMyTickets(
    @CurrentUser() user: JwtPayload,
    @Query() query: TicketQueryDto,
  ) {
    return this.supportService.getMyTickets(user.sub, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific ticket by ID' })
  @ApiParam({ name: 'id', description: 'Ticket ID' })
  @ApiResponse({
    status: 200,
    description: 'Ticket details',
  })
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  async getTicketById(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.supportService.getTicketById(id, user.sub);
  }

  @Post(':id/reply')
  @ApiOperation({ summary: 'Reply to a support ticket' })
  @ApiParam({ name: 'id', description: 'Ticket ID' })
  @ApiResponse({
    status: 201,
    description: 'Reply sent successfully',
  })
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  @ApiResponse({ status: 409, description: 'Ticket is closed' })
  async replyToTicket(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: ReplyTicketDto,
  ) {
    return this.supportService.userReply(id, user.sub, dto);
  }

  @Post(':id/close')
  @ApiOperation({ summary: 'Close a support ticket' })
  @ApiParam({ name: 'id', description: 'Ticket ID' })
  @ApiResponse({
    status: 201,
    description: 'Ticket closed successfully',
  })
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  async closeTicket(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.supportService.closeTicket(id, user.sub);
  }
}
