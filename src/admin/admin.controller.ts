/**
 * Admin Controller
 * Handles all admin-only endpoints
 */
import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from "@nestjs/swagger";
import { AdminService } from "./admin.service";
import { GiftCardsService } from "../giftcards/giftcards.service";
import { SupportService } from "../support/support.service";
import { SettingsService } from "../settings/settings.service";
import { BulkUpdateSettingsDto } from "../settings/dto";
import {
  ManualWalletAdjustmentDto,
  UsersQueryDto,
  UpdateUserStatusDto,
  UpdateUserDetailsDto,
  VtuQueryDto,
  VtuTransactionType,
  ManualVtuRefundDto,
  PaystackQueryDto,
  DashboardStatsResponse,
} from "./dto";
import {
  CreateBrandDto,
  UpdateBrandDto,
  BrandQueryDto,
  CreateCategoryDto,
  UpdateCategoryDto,
  CategoryQueryDto,
  CreateRateDto,
  UpdateRateDto,
  RateQueryDto,
  ReviewTradeDto,
  TradeQueryDto,
} from "../giftcards/dto";
import { TransactionsQueryDto } from "../wallet/dto";
import {
  AdminTicketQueryDto,
  AdminReplyTicketDto,
  UpdateTicketStatusDto,
} from "../support/dto";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { CurrentUser, Roles } from "../common/decorators";
import { JwtPayload } from "../auth/strategies/jwt.strategy";

@ApiTags("Admin")
@Controller("admin")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN")
@ApiBearerAuth("JWT-auth")
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly giftCardsService: GiftCardsService,
    private readonly supportService: SupportService,
    private readonly settingsService: SettingsService,
  ) {}

  // ============================================
  // DASHBOARD
  // ============================================

  @Get("dashboard/stats")
  @ApiOperation({ summary: "Get admin dashboard statistics" })
  @ApiResponse({
    status: 200,
    description: "Dashboard statistics",
    type: DashboardStatsResponse,
  })
  async getDashboardStats() {
    return this.adminService.getDashboardStats();
  }

  @Get("dashboard/recent")
  @ApiOperation({ summary: "Get recent activity for dashboard" })
  @ApiResponse({
    status: 200,
    description: "Recent trades and transactions",
  })
  async getDashboardRecent() {
    return this.adminService.getDashboardRecent();
  }

  // ============================================
  // USER MANAGEMENT
  // ============================================

  @Get("users")
  @ApiOperation({ summary: "Get all users with filters" })
  @ApiResponse({ status: 200, description: "Paginated list of users" })
  async getUsers(@Query() query: UsersQueryDto) {
    return this.adminService.getUsers(query);
  }

  @Get("users/:id")
  @ApiOperation({ summary: "Get user details by ID" })
  @ApiParam({ name: "id", description: "User ID" })
  @ApiResponse({
    status: 200,
    description: "User details with wallet and stats",
  })
  @ApiResponse({ status: 404, description: "User not found" })
  async getUserById(@Param("id") id: string) {
    return this.adminService.getUserById(id);
  }

  @Patch("users/:id/status")
  @ApiOperation({ summary: "Update user status (suspend/reactivate)" })
  @ApiParam({ name: "id", description: "User ID" })
  @ApiResponse({ status: 200, description: "User status updated" })
  @ApiResponse({ status: 404, description: "User not found" })
  async updateUserStatus(
    @Param("id") id: string,
    @CurrentUser() admin: JwtPayload,
    @Body() dto: UpdateUserStatusDto,
  ) {
    return this.adminService.updateUserStatus(id, admin.sub, dto);
  }

  @Patch("users/:id")
  @ApiOperation({ summary: "Update user details (admin edit)" })
  @ApiParam({ name: "id", description: "User ID" })
  @ApiResponse({ status: 200, description: "User details updated" })
  @ApiResponse({ status: 404, description: "User not found" })
  async updateUserDetails(
    @Param("id") id: string,
    @CurrentUser() admin: JwtPayload,
    @Body() dto: UpdateUserDetailsDto,
  ) {
    return this.adminService.updateUserDetails(id, admin.sub, dto);
  }

  @Get("users/:id/transactions")
  @ApiOperation({ summary: "Get wallet transactions for a specific user" })
  @ApiParam({ name: "id", description: "User ID" })
  @ApiResponse({ status: 200, description: "Paginated wallet transactions" })
  async getUserTransactions(
    @Param("id") id: string,
    @Query() query: TransactionsQueryDto,
  ) {
    return this.adminService.getUserWalletTransactions(id, query);
  }

  // ============================================
  // WALLET MANAGEMENT
  // ============================================

  @Get("wallet/transactions")
  @ApiOperation({ summary: "Get all wallet transactions" })
  @ApiResponse({ status: 200, description: "Paginated wallet transactions" })
  async getWalletTransactions(@Query() query: TransactionsQueryDto) {
    return this.adminService.getAllWalletTransactions(query);
  }

  @Get("wallet/transactions/:id")
  @ApiOperation({ summary: "Get single wallet transaction details" })
  @ApiParam({ name: "id", description: "Transaction ID" })
  @ApiResponse({ status: 200, description: "Wallet transaction details" })
  @ApiResponse({ status: 404, description: "Transaction not found" })
  async getWalletTransaction(@Param("id") id: string) {
    return this.adminService.getWalletTransactionById(id);
  }

  @Post("wallet/adjustment")
  @ApiOperation({ summary: "Manual wallet credit/debit adjustment" })
  @ApiResponse({ status: 201, description: "Adjustment completed" })
  @ApiResponse({ status: 404, description: "User not found" })
  async manualWalletAdjustment(
    @CurrentUser() admin: JwtPayload,
    @Body() dto: ManualWalletAdjustmentDto,
  ) {
    return this.adminService.manualWalletAdjustment(admin.sub, dto);
  }

  // ============================================
  // GIFT CARD BRAND MANAGEMENT
  // ============================================

  @Get("giftcards/brands")
  @ApiOperation({ summary: "Get all brands (admin view)" })
  @ApiResponse({ status: 200, description: "Paginated list of brands" })
  async getBrands(@Query() query: BrandQueryDto) {
    return this.giftCardsService.getBrands(query);
  }

  @Post("giftcards/brands")
  @ApiOperation({ summary: "Create a new brand" })
  @ApiResponse({ status: 201, description: "Brand created" })
  @ApiResponse({ status: 409, description: "Brand already exists" })
  async createBrand(@Body() dto: CreateBrandDto) {
    return this.giftCardsService.createBrand(dto);
  }

  @Put("giftcards/brands/:id")
  @ApiOperation({ summary: "Update a brand" })
  @ApiParam({ name: "id", description: "Brand ID" })
  @ApiResponse({ status: 200, description: "Brand updated" })
  @ApiResponse({ status: 404, description: "Brand not found" })
  async updateBrand(@Param("id") id: string, @Body() dto: UpdateBrandDto) {
    return this.giftCardsService.updateBrand(id, dto);
  }

  @Delete("giftcards/brands/:id")
  @ApiOperation({ summary: "Delete a brand (soft-delete)" })
  @ApiParam({ name: "id", description: "Brand ID" })
  @ApiResponse({ status: 200, description: "Brand deleted" })
  @ApiResponse({ status: 404, description: "Brand not found" })
  async deleteBrand(@Param("id") id: string) {
    return this.giftCardsService.deleteBrand(id);
  }

  // ============================================
  // GIFT CARD CATEGORY MANAGEMENT
  // ============================================

  @Get("giftcards/categories")
  @ApiOperation({ summary: "Get all categories (admin view)" })
  @ApiResponse({ status: 200, description: "Paginated list of categories" })
  async getCategories(@Query() query: CategoryQueryDto) {
    return this.giftCardsService.getCategories(query);
  }

  @Post("giftcards/categories")
  @ApiOperation({ summary: "Create a new category" })
  @ApiResponse({ status: 201, description: "Category created" })
  @ApiResponse({ status: 404, description: "Brand not found" })
  @ApiResponse({ status: 409, description: "Category slug already exists" })
  async createCategory(@Body() dto: CreateCategoryDto) {
    return this.giftCardsService.createCategory(dto);
  }

  @Put("giftcards/categories/:id")
  @ApiOperation({ summary: "Update a category" })
  @ApiParam({ name: "id", description: "Category ID" })
  @ApiResponse({ status: 200, description: "Category updated" })
  @ApiResponse({ status: 404, description: "Category not found" })
  async updateCategory(
    @Param("id") id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.giftCardsService.updateCategory(id, dto);
  }

  @Delete("giftcards/categories/:id")
  @ApiOperation({ summary: "Delete a category (soft-delete)" })
  @ApiParam({ name: "id", description: "Category ID" })
  @ApiResponse({ status: 200, description: "Category deleted" })
  @ApiResponse({ status: 404, description: "Category not found" })
  async deleteCategory(@Param("id") id: string) {
    return this.giftCardsService.deleteCategory(id);
  }

  // ============================================
  // GIFT CARD RATE MANAGEMENT
  // ============================================

  @Get("giftcards/rates")
  @ApiOperation({ summary: "Get all rates (admin view)" })
  @ApiResponse({ status: 200, description: "Paginated list of rates" })
  async getRates(@Query() query: RateQueryDto) {
    return this.giftCardsService.getRates(query);
  }

  @Post("giftcards/rates")
  @ApiOperation({ summary: "Create a new rate" })
  @ApiResponse({ status: 201, description: "Rate created" })
  @ApiResponse({ status: 404, description: "Category not found" })
  @ApiResponse({ status: 409, description: "Overlapping rate range exists" })
  async createRate(@Body() dto: CreateRateDto) {
    return this.giftCardsService.createRate(dto);
  }

  @Put("giftcards/rates/:id")
  @ApiOperation({ summary: "Update a rate" })
  @ApiParam({ name: "id", description: "Rate ID" })
  @ApiResponse({ status: 200, description: "Rate updated" })
  @ApiResponse({ status: 404, description: "Rate not found" })
  async updateRate(@Param("id") id: string, @Body() dto: UpdateRateDto) {
    return this.giftCardsService.updateRate(id, dto);
  }

  @Delete("giftcards/rates/:id")
  @ApiOperation({ summary: "Delete a rate (soft-delete)" })
  @ApiParam({ name: "id", description: "Rate ID" })
  @ApiResponse({ status: 200, description: "Rate deleted" })
  @ApiResponse({ status: 404, description: "Rate not found" })
  async deleteRate(@Param("id") id: string) {
    return this.giftCardsService.deleteRate(id);
  }

  // ============================================
  // GIFT CARD TRADE MANAGEMENT
  // ============================================

  @Get("giftcards/trades")
  @ApiOperation({ summary: "Get all trades (admin view)" })
  @ApiResponse({ status: 200, description: "Paginated list of trades" })
  async getTrades(@Query() query: TradeQueryDto) {
    return this.adminService.getTrades(query);
  }

  @Get("giftcards/trades/stats")
  @ApiOperation({ summary: "Get trade statistics" })
  @ApiResponse({ status: 200, description: "Trade statistics" })
  async getTradeStats() {
    return this.adminService.getTradeStats();
  }

  @Get("giftcards/trades/:id")
  @ApiOperation({ summary: "Get trade details by ID" })
  @ApiParam({ name: "id", description: "Trade ID" })
  @ApiResponse({ status: 200, description: "Trade details" })
  @ApiResponse({ status: 404, description: "Trade not found" })
  async getTradeById(@Param("id") id: string) {
    return this.adminService.getTradeById(id);
  }

  @Post("giftcards/trades/:id/review")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Review/approve/reject a trade" })
  @ApiParam({ name: "id", description: "Trade ID" })
  @ApiResponse({ status: 200, description: "Trade reviewed" })
  @ApiResponse({ status: 400, description: "Invalid review action" })
  @ApiResponse({ status: 404, description: "Trade not found" })
  async reviewTrade(
    @Param("id") id: string,
    @CurrentUser() admin: JwtPayload,
    @Body() dto: ReviewTradeDto,
  ) {
    return this.adminService.reviewTrade(id, admin.sub, dto);
  }

  // ============================================
  // VTU MANAGEMENT
  // ============================================

  @Get("vtu/transactions")
  @ApiOperation({ summary: "Get VTU transactions (airtime + data)" })
  @ApiResponse({ status: 200, description: "Paginated VTU transactions" })
  async getVtuTransactions(@Query() query: VtuQueryDto) {
    return this.adminService.getVtuTransactions(query);
  }

  @Get("vtu/transactions/:type/:id")
  @ApiOperation({ summary: "Get single VTU transaction details" })
  @ApiParam({
    name: "type",
    enum: VtuTransactionType,
    description: "Transaction type",
  })
  @ApiParam({ name: "id", description: "Transaction ID" })
  @ApiResponse({ status: 200, description: "VTU transaction details" })
  @ApiResponse({ status: 404, description: "Transaction not found" })
  async getVtuTransaction(
    @Param("type") type: VtuTransactionType,
    @Param("id") id: string,
  ) {
    return this.adminService.getVtuTransaction(id, type);
  }

  @Post("vtu/transactions/:type/:id/refund")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Manual refund for failed VTU transaction" })
  @ApiParam({
    name: "type",
    enum: VtuTransactionType,
    description: "Transaction type",
  })
  @ApiParam({ name: "id", description: "Transaction ID" })
  @ApiResponse({ status: 200, description: "Refund processed" })
  @ApiResponse({ status: 400, description: "Cannot refund this transaction" })
  @ApiResponse({ status: 404, description: "Transaction not found" })
  async manualVtuRefund(
    @Param("type") type: VtuTransactionType,
    @Param("id") id: string,
    @CurrentUser() admin: JwtPayload,
    @Body() dto: ManualVtuRefundDto,
  ) {
    return this.adminService.manualVtuRefund(id, type, admin.sub, dto);
  }

  // ============================================
  // PAYSTACK MANAGEMENT
  // ============================================

  @Get("paystack/transactions")
  @ApiOperation({ summary: "Get Paystack transactions" })
  @ApiResponse({ status: 200, description: "Paginated Paystack transactions" })
  async getPaystackTransactions(@Query() query: PaystackQueryDto) {
    return this.adminService.getPaystackTransactions(query);
  }

  @Get("paystack/transactions/:id")
  @ApiOperation({ summary: "Get single Paystack transaction" })
  @ApiParam({ name: "id", description: "Transaction ID" })
  @ApiResponse({ status: 200, description: "Paystack transaction details" })
  @ApiResponse({ status: 404, description: "Transaction not found" })
  async getPaystackTransaction(@Param("id") id: string) {
    return this.adminService.getPaystackTransaction(id);
  }

  @Get("vtu/stats")
  @ApiOperation({
    summary: "Get VTU revenue stats (profit, sales, costs, counts)",
  })
  @ApiResponse({ status: 200, description: "VTU revenue statistics" })
  async getVtuStats() {
    return this.adminService.getVtuStats();
  }

  // ============================================
  // SUPPORT TICKET MANAGEMENT
  // ============================================

  @Get("support/tickets")
  @ApiOperation({ summary: "Get all support tickets (admin view)" })
  @ApiResponse({ status: 200, description: "Paginated list of tickets" })
  async getSupportTickets(@Query() query: AdminTicketQueryDto) {
    return this.supportService.adminGetTickets(query);
  }

  @Get("support/tickets/stats")
  @ApiOperation({ summary: "Get support ticket statistics" })
  @ApiResponse({ status: 200, description: "Ticket statistics" })
  async getSupportTicketStats() {
    return this.supportService.adminGetTicketStats();
  }

  @Get("support/tickets/:id")
  @ApiOperation({ summary: "Get support ticket details by ID" })
  @ApiParam({ name: "id", description: "Ticket ID" })
  @ApiResponse({ status: 200, description: "Ticket details" })
  @ApiResponse({ status: 404, description: "Ticket not found" })
  async getSupportTicketById(@Param("id") id: string) {
    return this.supportService.adminGetTicketById(id);
  }

  @Post("support/tickets/:id/reply")
  @ApiOperation({ summary: "Reply to a support ticket (admin)" })
  @ApiParam({ name: "id", description: "Ticket ID" })
  @ApiResponse({ status: 201, description: "Reply sent" })
  @ApiResponse({ status: 404, description: "Ticket not found" })
  async replySupportTicket(
    @Param("id") id: string,
    @CurrentUser() admin: JwtPayload,
    @Body() dto: AdminReplyTicketDto,
  ) {
    return this.supportService.adminReply(id, admin.sub, dto);
  }

  @Patch("support/tickets/:id/status")
  @ApiOperation({ summary: "Update support ticket status" })
  @ApiParam({ name: "id", description: "Ticket ID" })
  @ApiResponse({ status: 200, description: "Ticket status updated" })
  @ApiResponse({ status: 404, description: "Ticket not found" })
  async updateSupportTicketStatus(
    @Param("id") id: string,
    @Body() dto: UpdateTicketStatusDto,
  ) {
    return this.supportService.adminUpdateStatus(id, dto);
  }

  // ============================================
  // APP SETTINGS
  // ============================================

  @Get("settings")
  @ApiOperation({ summary: "Get all app settings with metadata" })
  @ApiResponse({ status: 200, description: "All settings with full metadata" })
  async getAllSettings() {
    return this.settingsService.getAllSettings();
  }

  @Patch("settings")
  @ApiOperation({ summary: "Bulk update app settings" })
  @ApiResponse({ status: 200, description: "Settings updated" })
  async bulkUpdateSettings(@Body() dto: BulkUpdateSettingsDto) {
    return this.settingsService.bulkUpdate(dto);
  }

}
