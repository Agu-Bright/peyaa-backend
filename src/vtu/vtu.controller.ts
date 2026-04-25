/**
 * src/vtu/vtu.controller.ts
 *
 * VTU Controller
 * - GET /vtu/networks - List available networks
 * - GET /vtu/data-plans - Get data plans for a network (fetched from SquadCo)
 * - POST /vtu/airtime - Purchase airtime (PIN required)
 * - POST /vtu/data - Purchase data (PIN required)
 */
import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiSecurity,
  ApiQuery,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { PinGuard } from "../common/guards/pin.guard";
import { SquadCoService } from "./squadco.service";
import { PurchaseAirtimeDto, PurchaseDataDto } from "./dto";

@ApiTags("VTU")
@Controller("vtu")
export class VtuController {
  constructor(private readonly squadCoService: SquadCoService) {}

  /**
   * GET /vtu/networks
   * Returns list of supported networks
   */
  @Get("networks")
  @ApiOperation({ summary: "Get supported networks" })
  @ApiResponse({
    status: 200,
    description: "List of supported networks",
    schema: {
      type: "array",
      items: {
        type: "object",
        properties: {
          code: { type: "string", example: "MTN" },
          name: { type: "string", example: "MTN Nigeria" },
          logo: { type: "string", nullable: true },
          airtimeAvailable: { type: "boolean", example: true },
          dataAvailable: { type: "boolean", example: true },
        },
      },
    },
  })
  getNetworks() {
    return this.squadCoService.getNetworks();
  }

  /**
   * GET /vtu/detect-network
   * Detect network from phone number prefix
   */
  @Get("detect-network")
  @ApiOperation({ summary: "Detect network from phone number" })
  @ApiQuery({
    name: "phone",
    required: true,
    description: "Phone number to detect network for",
    example: "08031234567",
  })
  @ApiResponse({
    status: 200,
    description: "Detected network",
    schema: {
      type: "object",
      properties: {
        network: { type: "string", example: "MTN" },
        networkName: { type: "string", example: "MTN" },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: "Unable to detect network",
  })
  detectNetwork(@Query("phone") phone: string) {
    if (!phone) {
      throw new BadRequestException("Phone parameter is required");
    }

    const result = this.squadCoService.getNetworkFromPhone(phone);

    if (!result) {
      throw new BadRequestException(
        "Unable to detect network from phone number",
      );
    }

    return result;
  }

  /**
   * GET /vtu/data-plans
   * Returns data plans for a network (fetched from SquadCo API with caching)
   */
  @Get("data-plans")
  @ApiOperation({ summary: "Get data plans for a network" })
  @ApiQuery({
    name: "network",
    required: true,
    description: "Network code (MTN, GLO, AIRTEL, 9MOBILE/ETISALAT)",
    example: "MTN",
  })
  @ApiResponse({
    status: 200,
    description: "List of data plans",
    schema: {
      type: "array",
      items: {
        type: "object",
        properties: {
          planCode: { type: "string", example: "1001" },
          name: { type: "string", example: "MTN data_plan" },
          dataAmount: { type: "string", example: "1GB" },
          validity: { type: "string", example: "30 days" },
          price: { type: "number", example: 300 },
          network: { type: "string", example: "MTN" },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: "Invalid network",
  })
  async getDataPlans(@Query("network") network: string) {
    if (!network) {
      throw new BadRequestException("Network parameter is required");
    }
    return this.squadCoService.getDataPlans(network);
  }

  /**
   * POST /vtu/airtime
   * Purchase airtime (requires PIN)
   */
  @Post("airtime")
  @UseGuards(JwtAuthGuard, PinGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiSecurity("PIN-auth")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Purchase airtime" })
  @ApiResponse({
    status: 200,
    description: "Airtime purchased successfully",
  })
  @ApiResponse({
    status: 400,
    description: "Bad request / Insufficient balance",
  })
  @ApiResponse({
    status: 401,
    description: "Unauthorized",
  })
  async purchaseAirtime(@Req() req: any, @Body() dto: PurchaseAirtimeDto) {
    const userId = req.user.userId || req.user.sub;
    const result = await this.squadCoService.purchaseAirtime(userId, dto);

    return {
      success: true,
      message: "Airtime purchased successfully",
      data: {
        reference: result.reference,
        network: result.network,
        phoneNumber: result.phoneNumber,
        amount: result.amount,
        status: result.status,
        createdAt: result.createdAt,
      },
    };
  }

  /**
   * POST /vtu/data
   * Purchase data (requires PIN)
   */
  @Post("data")
  @UseGuards(JwtAuthGuard, PinGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiSecurity("PIN-auth")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Purchase data" })
  @ApiResponse({
    status: 200,
    description: "Data purchased successfully",
  })
  @ApiResponse({
    status: 400,
    description: "Bad request / Invalid plan / Insufficient balance",
  })
  @ApiResponse({
    status: 401,
    description: "Unauthorized",
  })
  async purchaseData(@Req() req: any, @Body() dto: PurchaseDataDto) {
    const userId = req.user.userId || req.user.sub;
    const result = await this.squadCoService.purchaseData(userId, dto);

    return {
      success: true,
      message: "Data purchased successfully",
      data: {
        reference: result.reference,
        network: result.network,
        phoneNumber: result.phoneNumber,
        planCode: result.planCode,
        planName: result.planName,
        dataAmount: result.dataAmount,
        validity: result.validity,
        amount: result.amount,
        status: result.status,
        createdAt: result.createdAt,
      },
    };
  }
}
