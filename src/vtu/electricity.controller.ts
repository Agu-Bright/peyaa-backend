/**
 * src/vtu/electricity.controller.ts
 *
 * Controller for electricity vending endpoints
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
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiHeader,
  ApiParam,
  ApiSecurity,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { PinGuard } from "../common/guards/pin.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { CurrentUser, Roles } from "../common/decorators";
import { ElectricityService } from "./electricity.service";
import {
  LookupMeterDto,
  PurchaseElectricityDto,
  GetElectricityPurchasesDto,
} from "./dto/electricity.dto";

@ApiTags("Electricity")
@Controller("electricity")
export class ElectricityController {
  constructor(private readonly electricityService: ElectricityService) {}

  /**
   * Get list of electricity providers
   */
  @Get("providers")
  @ApiOperation({ summary: "Get list of electricity providers" })
  @ApiResponse({
    status: 200,
    description: "List of electricity providers",
    schema: {
      type: "object",
      properties: {
        success: { type: "boolean", example: true },
        data: {
          type: "array",
          items: {
            type: "object",
            properties: {
              code: { type: "string", example: "IE" },
              name: { type: "string", example: "Ikeja Electricity" },
              logoUrl: { type: "string", nullable: true },
              region: { type: "string", example: "Lagos (Ikeja, Ikorodu...)" },
            },
          },
        },
      },
    },
  })
  async getProviders() {
    const providers = await this.electricityService.getProviders();
    return { success: true, data: providers };
  }

  /**
   * Lookup meter details
   */
  @Post("lookup")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Lookup meter details" })
  @ApiResponse({
    status: 200,
    description: "Meter details retrieved successfully",
    schema: {
      type: "object",
      properties: {
        success: { type: "boolean", example: true },
        data: {
          type: "object",
          properties: {
            reference: { type: "string", example: "IE-2505305db8e15f0ab62bb6" },
            customerName: { type: "string", example: "GALADIMA SHEHU MALAMI" },
            minimumVend: { type: "number", example: 12920.32 },
            accountType: { type: "string", example: "NMD" },
            outstandingDebt: { type: "string", example: "361257.12" },
            address: { type: "string", example: "9 ADEYEMO STREET MAFOLUKU" },
            meterType: { type: "string", example: "prepaid" },
            meterNumber: { type: "string", example: "45067198783" },
            provider: { type: "string", example: "IE" },
            providerName: { type: "string", example: "Ikeja Electricity" },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: "Invalid meter details" })
  async lookupMeter(@Body() dto: LookupMeterDto) {
    const data = await this.electricityService.lookupMeter(dto);
    return { success: true, data };
  }

  /**
   * Purchase electricity
   */
  @Post("purchase")
  @UseGuards(JwtAuthGuard, PinGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiSecurity("PIN-auth")
  @ApiHeader({
    name: "x-txn-pin",
    description: "4-digit transaction PIN",
    required: true,
  })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Purchase electricity (requires PIN)" })
  @ApiResponse({
    status: 200,
    description: "Electricity purchased successfully",
    schema: {
      type: "object",
      properties: {
        success: { type: "boolean", example: true },
        message: {
          type: "string",
          example: "Electricity purchased successfully",
        },
        data: {
          type: "object",
          properties: {
            reference: { type: "string" },
            provider: { type: "string" },
            providerName: { type: "string" },
            meterNumber: { type: "string" },
            meterType: { type: "string" },
            customerName: { type: "string" },
            amount: { type: "number" },
            token: { type: "string" },
            units: { type: "string" },
            status: { type: "string", example: "SUCCESS" },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: "Purchase failed" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  @ApiResponse({ status: 403, description: "Invalid PIN" })
  async purchaseElectricity(
    @CurrentUser("sub") userId: string,
    @Body() dto: PurchaseElectricityDto,
  ) {
    const purchase = await this.electricityService.purchaseElectricity(
      userId,
      dto,
    );

    return {
      success: true,
      message: "Electricity purchased successfully",
      data: {
        reference: purchase.reference,
        provider: purchase.provider,
        providerName: purchase.providerName,
        meterNumber: purchase.meterNumber,
        meterType: purchase.meterType,
        customerName: purchase.customerName,
        customerAddress: purchase.customerAddress,
        amount: purchase.amount,
        token: purchase.token,
        units: purchase.units,
        status: purchase.status,
        createdAt: purchase.createdAt,
      },
    };
  }

  /**
   * Get user's electricity purchases
   */
  @Get("purchases")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({ summary: "Get user electricity purchase history" })
  @ApiResponse({
    status: 200,
    description: "Purchase history retrieved",
  })
  async getUserPurchases(
    @CurrentUser("sub") userId: string,
    @Query() query: GetElectricityPurchasesDto,
  ) {
    const result = await this.electricityService.getUserPurchases(
      userId,
      query,
    );

    return {
      success: true,
      data: result.data,
      pagination: {
        total: result.total,
        page: result.page,
        pages: result.pages,
      },
    };
  }

  /**
   * Get purchase by reference
   */
  @Get("purchases/:reference")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({ summary: "Get electricity purchase by reference" })
  @ApiParam({ name: "reference", description: "Purchase reference" })
  @ApiResponse({ status: 200, description: "Purchase details retrieved" })
  @ApiResponse({ status: 404, description: "Purchase not found" })
  async getPurchaseByReference(
    @CurrentUser("sub") userId: string,
    @Param("reference") reference: string,
  ) {
    const purchase = await this.electricityService.getPurchaseByReference(
      userId,
      reference,
    );

    return { success: true, data: purchase };
  }
}

/**
 * Admin controller for electricity management
 */
@ApiTags("Admin - Electricity")
@Controller("admin/electricity")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN")
@ApiBearerAuth("JWT-auth")
export class AdminElectricityController {
  constructor(private readonly electricityService: ElectricityService) {}

  /**
   * Get all electricity purchases (admin)
   */
  @Get("purchases")
  @ApiOperation({ summary: "Get all electricity purchases (admin)" })
  @ApiResponse({ status: 200, description: "Purchases retrieved" })
  async getAllPurchases(
    @Query() query: GetElectricityPurchasesDto & { userId?: string },
  ) {
    const result = await this.electricityService.getAllPurchases(query);

    return {
      success: true,
      data: result.data,
      pagination: {
        total: result.total,
        page: result.page,
        pages: result.pages,
      },
    };
  }

  /**
   * Manual refund (admin)
   */
  @Post("purchases/:id/refund")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Manually refund failed electricity purchase (admin)",
  })
  @ApiParam({ name: "id", description: "Purchase ID" })
  @ApiResponse({ status: 200, description: "Refund processed" })
  @ApiResponse({ status: 400, description: "Cannot refund" })
  @ApiResponse({ status: 404, description: "Purchase not found" })
  async manualRefund(
    @CurrentUser("sub") adminId: string,
    @Param("id") id: string,
    @Body("reason") reason: string,
  ) {
    const purchase = await this.electricityService.manualRefund(
      id,
      adminId,
      reason || "Admin manual refund",
    );

    return {
      success: true,
      message: "Refund processed successfully",
      data: purchase,
    };
  }

   @Get('stats')
  @ApiOperation({ summary: 'Get electricity revenue stats (admin)' })
  @ApiResponse({ status: 200, description: 'Electricity stats with profit' })
  async getStats() {
    return {
      success: true,
      data: await this.electricityService.getAdminStats(),
    };
  }

}
